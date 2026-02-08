class OwnerCallSystem {
    constructor() {
        this.peer = null;
        this.dataConnections = new Map(); // Store multiple user connections
        this.mediaConnections = new Map(); // Store active calls
        this.localStream = null;
        this.ownerId = null;
        this.isInCall = false;
        
        // DOM Elements
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusText = document.getElementById('statusText');
        this.ownerIdDisplay = document.getElementById('ownerIdDisplay');
        this.userCountSpan = document.getElementById('userCount');
        this.callNotification = document.getElementById('callNotification');
        this.callerInfo = document.getElementById('callerInfo');
        this.acceptBtn = document.getElementById('acceptBtn');
        this.rejectBtn = document.getElementById('rejectBtn');
        this.callControls = document.getElementById('callControls');
        this.remoteAudio = document.getElementById('remoteAudio');
        this.endCallBtn = document.getElementById('endCallBtn');
        this.idleMessage = document.getElementById('idleMessage');
        this.notification = document.getElementById('notification');
        
        this.init();
    }
    
    async init() {
        // Generate consistent Owner ID (based on username + random)
        const username = 'owner';
        const randomId = Math.random().toString(36).substr(2, 6);
        this.ownerId = `${username}-${randomId}`;
        
        // Initialize PeerJS with our ID
        this.peer = new Peer(this.ownerId, {
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
            debug: 3
        });
        
        this.setupPeerListeners();
        this.setupEventListeners();
        this.requestMicrophone();
        this.setupPWAFeatures();
        this.setupWakeLock();
    }
    
    async requestMicrophone() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1
                },
                video: false
            });
            console.log("Owner microphone ready");
        } catch (error) {
            console.error("Microphone error:", error);
            this.showNotification("Microphone access required", "error");
        }
    }
    
    setupPeerListeners() {
        // When PeerJS connection is ready
        this.peer.on('open', (id) => {
            console.log("Owner connected with ID:", id);
            this.ownerIdDisplay.textContent = id;
            this.updateStatus('online');
            this.showNotification("Ready to receive calls", "success");
            
            // Make ID easily copyable
            this.ownerIdDisplay.onclick = () => {
                navigator.clipboard.writeText(id);
                this.showNotification("ID copied to clipboard!", "success");
            };
        });
        
        // Handle incoming data connections (users connecting)
        this.peer.on('connection', (connection) => {
            console.log("New user connected:", connection.peer);
            
            // Store the connection
            this.dataConnections.set(connection.peer, connection);
            this.updateUserCount();
            
            this.setupDataConnection(connection);
            
            // Send status to this user
            connection.send({
                type: 'owner-status',
                status: this.isInCall ? 'busy' : 'available'
            });
        });
        
        // Handle incoming calls
        this.peer.on('call', async (call) => {
            console.log("Incoming call from:", call.peer);
            
            if (this.isInCall) {
                // Send busy signal
                const userConn = this.dataConnections.get(call.peer);
                if (userConn) {
                    userConn.send({ type: 'owner-busy' });
                }
                call.close();
                return;
            }
            
            // Store the incoming call
            this.currentCaller = call.peer;
            this.mediaConnections.set(call.peer, call);
            
            // Show call notification
            this.showCallNotification(call.peer);
        });
        
        this.peer.on('error', (err) => {
            console.error("PeerJS error:", err);
            this.updateStatus('offline');
            
            // Auto-reconnect
            setTimeout(() => {
                if (this.peer.disconnected) {
                    this.peer.reconnect();
                }
            }, 3000);
        });
        
        this.peer.on('disconnected', () => {
            console.log("Disconnected from PeerJS");
            this.updateStatus('offline');
            
            setTimeout(() => {
                this.peer.reconnect();
            }, 2000);
        });
    }
    
    setupDataConnection(connection) {
        connection.on('data', (data) => {
            console.log("Data from", connection.peer, ":", data);
            
            if (data.type === 'call-started') {
                // User started a call
                this.isInCall = true;
                this.updateStatus('busy');
                
                // Notify all other users that owner is busy
                this.broadcastToAllUsers({ 
                    type: 'owner-status', 
                    status: 'busy' 
                }, connection.peer);
                
            } else if (data.type === 'call-ended') {
                // User ended the call
                this.endCall();
            }
        });
        
        connection.on('close', () => {
            console.log("User disconnected:", connection.peer);
            this.dataConnections.delete(connection.peer);
            this.mediaConnections.delete(connection.peer);
            this.updateUserCount();
            
            // If this was the current caller and we're in a call, end it
            if (this.currentCaller === connection.peer && this.isInCall) {
                this.endCall();
            }
        });
    }
    
    setupEventListeners() {
        // Accept call button
        this.acceptBtn.addEventListener('click', () => this.acceptCall());
        
        // Reject call button
        this.rejectBtn.addEventListener('click', () => this.rejectCall());
        
        // End call button
        this.endCallBtn.addEventListener('click', () => this.endCall());
    }
    
    async acceptCall() {
        if (!this.currentCaller || !this.localStream) return;
        
        const call = this.mediaConnections.get(this.currentCaller);
        if (!call) return;
        
        try {
            // Answer the call
            call.answer(this.localStream);
            
            // Handle the remote audio stream
            call.on('stream', (remoteStream) => {
                this.remoteAudio.srcObject = remoteStream;
                this.showCallControls();
                this.hideCallNotification();
                this.isInCall = true;
                this.updateStatus('busy');
                
                // Notify the caller
                const userConn = this.dataConnections.get(this.currentCaller);
                if (userConn) {
                    userConn.send({ type: 'call-accepted' });
                }
            });
            
            call.on('close', () => {
                this.endCall();
            });
            
            call.on('error', (err) => {
                console.error("Call error:", err);
                this.endCall();
                this.showNotification("Call error", "error");
            });
            
        } catch (error) {
            console.error("Error accepting call:", error);
            this.endNotification();
            this.showNotification("Failed to accept call", "error");
        }
    }
    
    rejectCall() {
        if (this.currentCaller) {
            const userConn = this.dataConnections.get(this.currentCaller);
            if (userConn) {
                userConn.send({ type: 'call-rejected' });
            }
            
            const call = this.mediaConnections.get(this.currentCaller);
            if (call) {
                call.close();
            }
            
            this.mediaConnections.delete(this.currentCaller);
            this.hideCallNotification();
            this.currentCaller = null;
        }
    }
    
    endCall() {
        // Close all media connections
        this.mediaConnections.forEach((call, peerId) => {
            call.close();
        });
        this.mediaConnections.clear();
        
        // Clear audio
        if (this.remoteAudio.srcObject) {
            this.remoteAudio.srcObject = null;
        }
        
        // Reset state
        this.isInCall = false;
        this.currentCaller = null;
        
        // Update UI
        this.hideCallControls();
        this.hideCallNotification();
        this.updateStatus('online');
        
        // Notify all users that owner is available again
        this.broadcastToAllUsers({ 
            type: 'owner-status', 
            status: 'available' 
        });
        
        this.showNotification("Call ended", "info");
    }
    
    broadcastToAllUsers(data, excludePeer = null) {
        this.dataConnections.forEach((conn, peerId) => {
            if (peerId !== excludePeer && conn.open) {
                conn.send(data);
            }
        });
    }
    
    showCallNotification(callerId) {
        this.callerInfo.textContent = `Call from: ${callerId}`;
        this.callNotification.classList.add('active');
        this.idleMessage.style.display = 'none';
        
        // Play ringtone if not in call
        if (!this.isInCall) {
            this.playRingtone();
        }
    }
    
    hideCallNotification() {
        this.callNotification.classList.remove('active');
        this.idleMessage.style.display = 'block';
        this.stopRingtone();
    }
    
    showCallControls() {
        this.callControls.style.display = 'block';
        this.idleMessage.style.display = 'none';
    }
    
    hideCallControls() {
        this.callControls.style.display = 'none';
        this.idleMessage.style.display = 'block';
    }
    
    updateStatus(status) {
        const statusMap = {
            online: { class: 'online', text: 'Online', dot: 'green-dot' },
            offline: { class: 'offline', text: 'Offline', dot: 'red-dot' },
            busy: { class: 'busy', text: 'In Call', dot: 'yellow-dot' }
        };
        
        const statusInfo = statusMap[status];
        this.statusIndicator.className = `status-indicator ${statusInfo.class}`;
        this.statusText.textContent = statusInfo.text;
        
        // Update dot
        const dot = this.statusIndicator.querySelector('.dot');
        if (dot) {
            dot.className = `dot ${statusInfo.dot}`;
        }
    }
    
    updateUserCount() {
        this.userCountSpan.textContent = this.dataConnections.size;
    }
    
    playRingtone() {
        // Create a simple ringtone using Web Audio API
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.type = 'sine';
            oscillator.frequency.value = 800;
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.5);
            
            // Repeat every 2 seconds
            this.ringtoneInterval = setInterval(() => {
                if (!this.isInCall && this.callNotification.classList.contains('active')) {
                    oscillator.start();
                    oscillator.stop(audioContext.currentTime + 0.5);
                }
            }, 2000);
            
        } catch (error) {
            console.log("Could not play ringtone:", error);
        }
    }
    
    stopRingtone() {
        if (this.ringtoneInterval) {
            clearInterval(this.ringtoneInterval);
            this.ringtoneInterval = null;
        }
    }
    
    showNotification(message, type) {
        this.notification.textContent = message;
        this.notification.className = `notification ${type}`;
        this.notification.style.display = 'block';
        
        setTimeout(() => {
            this.notification.style.display = 'none';
        }, 3000);
    }
    
    setupPWAFeatures() {
        // Prevent iOS from sleeping
        if ('wakeLock' in navigator) {
            navigator.wakeLock.request('screen').catch(console.error);
        }
        
        // Handle app visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log("App is in background");
            } else {
                console.log("App is in foreground");
            }
        });
        
        // Keep alive ping
        setInterval(() => {
            if (this.peer && !this.peer.disconnected) {
                // Send ping to keep connection alive
                this.broadcastToAllUsers({ type: 'ping', timestamp: Date.now() });
            }
        }, 30000); // Every 30 seconds
    }
    
    setupWakeLock() {
        // Request wake lock to prevent screen sleep
        let wakeLock = null;
        
        const requestWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                    console.log('Wake Lock is active');
                    
                    wakeLock.addEventListener('release', () => {
                        console.log('Wake Lock was released');
                    });
                }
            } catch (err) {
                console.error(`${err.name}, ${err.message}`);
            }
        };
        
        requestWakeLock();
        
        // Re-request wake lock when page becomes visible
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible') {
                await requestWakeLock();
            }
        });
    }
}

// Initialize when page loads
window.addEventListener('load', () => {
    // Check for WebRTC support
    if (!navigator.mediaDevices || !window.Peer) {
        alert("Your browser doesn't support WebRTC or PeerJS. Please use Chrome, Firefox, or Edge.");
        return;
    }
    
    new OwnerCallSystem();
});

// Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(
            registration => {
                console.log('ServiceWorker registered');
            },
            err => {
                console.log('ServiceWorker registration failed:', err);
            }
        );
    });
}