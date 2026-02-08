class CallSystem {
    constructor() {
        // Configuration - Using PeerJS Cloud Server (FREE)
        this.peer = null;
        this.conn = null;
        this.call = null;
        this.localStream = null;
        this.ownerId = null;
        
        // DOM Elements
        this.ownerIdInput = document.getElementById('ownerIdInput');
        this.connectBtn = document.getElementById('connectBtn');
        this.callBtn = document.getElementById('callBtn');
        this.statusDiv = document.getElementById('status');
        this.callStatusDiv = document.getElementById('callStatus');
        this.remoteAudio = document.getElementById('remoteAudio');
        this.localAudio = document.getElementById('localAudio');
        this.connectionPanel = document.getElementById('connectionPanel');
        this.callPanel = document.getElementById('callPanel');
        this.ownerStatus = document.getElementById('ownerStatus');
        
        this.init();
    }
    
    async init() {
        // Generate random user ID
        const userId = 'user-' + Math.random().toString(36).substr(2, 9);
        
        // Initialize PeerJS connection to FREE PeerJS Cloud Server
        this.peer = new Peer(userId, {
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
            debug: 3
        });
        
        this.setupPeerListeners();
        this.setupEventListeners();
        this.requestMicrophone();
    }
    
    async requestMicrophone() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            
            // Play local audio (muted) to detect issues
            this.localAudio.srcObject = this.localStream;
            console.log("Microphone access granted");
        } catch (error) {
            console.error("Microphone error:", error);
            this.showMessage("Please allow microphone access to make calls", "error");
        }
    }
    
    setupPeerListeners() {
        // Handle PeerJS connection
        this.peer.on('open', (id) => {
            console.log("User connected with ID:", id);
            this.showMessage("Ready to connect to owner", "info");
        });
        
        this.peer.on('connection', (connection) => {
            console.log("Incoming data connection:", connection.peer);
            this.conn = connection;
            this.setupDataConnection(connection);
        });
        
        this.peer.on('call', async (incomingCall) => {
            console.log("Incoming call from:", incomingCall.peer);
            
            try {
                // Answer the call with local stream
                incomingCall.answer(this.localStream);
                this.call = incomingCall;
                
                // Handle remote stream
                this.call.on('stream', (remoteStream) => {
                    this.remoteAudio.srcObject = remoteStream;
                    this.updateCallStatus("Call connected!");
                    this.callBtn.textContent = "📞 End Call";
                    this.callBtn.classList.add('end-call');
                    this.statusDiv.textContent = "In Call";
                    this.statusDiv.className = "status calling";
                });
                
                this.call.on('close', () => {
                    this.endCall();
                    this.updateCallStatus("Call ended");
                });
                
                this.call.on('error', (err) => {
                    console.error("Call error:", err);
                    this.endCall();
                    this.updateCallStatus("Call error occurred");
                });
                
            } catch (error) {
                console.error("Error answering call:", error);
            }
        });
        
        this.peer.on('error', (err) => {
            console.error("PeerJS error:", err);
            
            // Auto-reconnect on certain errors
            if (err.type === 'peer-unavailable' || err.type === 'network') {
                setTimeout(() => {
                    this.reconnectToOwner();
                }, 3000);
            }
        });
        
        this.peer.on('disconnected', () => {
            console.log("Disconnected from PeerJS server");
            this.statusDiv.textContent = "Disconnected";
            this.statusDiv.className = "status offline";
            
            // Attempt to reconnect
            setTimeout(() => {
                this.peer.reconnect();
            }, 2000);
        });
    }
    
    setupEventListeners() {
        // Connect to owner button
        this.connectBtn.addEventListener('click', () => {
            this.connectToOwner();
        });
        
        // Call button
        this.callBtn.addEventListener('click', () => {
            if (this.call) {
                this.endCall();
            } else {
                this.startCall();
            }
        });
        
        // Enter key in owner ID input
        this.ownerIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.connectToOwner();
            }
        });
    }
    
    connectToOwner() {
        const ownerId = this.ownerIdInput.value.trim();
        
        if (!ownerId) {
            this.showMessage("Please enter Owner ID", "error");
            return;
        }
        
        this.ownerId = ownerId;
        
        // Establish data connection first
        this.conn = this.peer.connect(ownerId, {
            reliable: true,
            serialization: 'json'
        });
        
        this.setupDataConnection(this.conn);
        
        this.showMessage("Connecting to owner...", "info");
    }
    
    setupDataConnection(connection) {
        connection.on('open', () => {
            console.log("Data connection established with owner");
            this.showMessage("Connected to owner!", "success");
            this.ownerStatus.textContent = "Connected";
            this.ownerStatus.style.color = "green";
            
            // Show call panel
            this.connectionPanel.style.display = 'none';
            this.callPanel.style.display = 'block';
            
            // Send connection confirmation
            connection.send({
                type: 'user-connected',
                userId: this.peer.id
            });
        });
        
        connection.on('data', (data) => {
            console.log("Received data:", data);
            
            if (data.type === 'owner-status') {
                if (data.status === 'available') {
                    this.statusDiv.textContent = "Owner Available";
                    this.statusDiv.className = "status online";
                    this.callBtn.disabled = false;
                } else if (data.status === 'busy') {
                    this.statusDiv.textContent = "Owner Busy";
                    this.statusDiv.className = "status offline";
                    this.callBtn.disabled = true;
                }
            } else if (data.type === 'call-rejected') {
                this.updateCallStatus("Call rejected by owner");
                this.endCall();
            } else if (data.type === 'call-ended') {
                this.updateCallStatus("Call ended by owner");
                this.endCall();
            }
        });
        
        connection.on('close', () => {
            console.log("Data connection closed");
            this.ownerStatus.textContent = "Disconnected";
            this.ownerStatus.style.color = "red";
            this.statusDiv.textContent = "Owner Offline";
            this.statusDiv.className = "status offline";
            this.callBtn.disabled = true;
            
            // Show connection panel again
            this.callPanel.style.display = 'none';
            this.connectionPanel.style.display = 'block';
            
            this.showMessage("Disconnected from owner", "error");
        });
        
        connection.on('error', (err) => {
            console.error("Data connection error:", err);
        });
    }
    
    async startCall() {
        if (!this.ownerId || !this.localStream) {
            this.showMessage("Not ready to call", "error");
            return;
        }
        
        try {
            // Initiate call
            this.call = this.peer.call(this.ownerId, this.localStream);
            
            this.updateCallStatus("Calling owner...");
            this.callBtn.disabled = true;
            
            // Handle call events
            this.call.on('stream', (remoteStream) => {
                this.remoteAudio.srcObject = remoteStream;
                this.updateCallStatus("Call connected!");
                this.callBtn.disabled = false;
                this.callBtn.textContent = "📞 End Call";
                this.callBtn.classList.add('end-call');
                this.statusDiv.textContent = "In Call";
                this.statusDiv.className = "status calling";
                
                // Notify owner via data connection
                if (this.conn) {
                    this.conn.send({ type: 'call-started' });
                }
            });
            
            this.call.on('close', () => {
                this.endCall();
                this.updateCallStatus("Call ended");
            });
            
            this.call.on('error', (err) => {
                console.error("Call error:", err);
                this.endCall();
                this.updateCallStatus("Call failed");
            });
            
        } catch (error) {
            console.error("Error starting call:", error);
            this.updateCallStatus("Error starting call");
            this.endCall();
        }
    }
    
    endCall() {
        if (this.call) {
            this.call.close();
            this.call = null;
        }
        
        if (this.remoteAudio.srcObject) {
            this.remoteAudio.srcObject = null;
        }
        
        this.callBtn.textContent = "📞 Call Owner";
        this.callBtn.classList.remove('end-call');
        this.callBtn.disabled = false;
        
        if (this.conn && this.conn.open) {
            this.conn.send({ type: 'call-ended' });
        }
        
        this.statusDiv.textContent = "Owner Available";
        this.statusDiv.className = "status online";
    }
    
    reconnectToOwner() {
        if (this.ownerId) {
            this.showMessage("Reconnecting to owner...", "info");
            this.connectToOwner();
        }
    }
    
    updateCallStatus(message) {
        this.callStatusDiv.textContent = message;
        this.callStatusDiv.style.color = message.includes("Error") ? "red" : "black";
    }
    
    showMessage(message, type) {
        // Simple message display
        const colors = {
            error: "#f44336",
            success: "#4CAF50",
            info: "#2196F3"
        };
        
        this.callStatusDiv.textContent = message;
        this.callStatusDiv.style.color = colors[type] || "black";
        
        // Auto-clear after 5 seconds
        setTimeout(() => {
            if (this.callStatusDiv.textContent === message) {
                this.callStatusDiv.textContent = '';
            }
        }, 5000);
    }
}

// Initialize when page loads
window.addEventListener('load', () => {
    // Check for WebRTC support
    if (!navigator.mediaDevices || !window.Peer) {
        alert("Your browser doesn't support WebRTC or PeerJS. Please use Chrome, Firefox, or Edge.");
        return;
    }
    
    new CallSystem();
});