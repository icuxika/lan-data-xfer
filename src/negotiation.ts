class SignalingChannel {
    socket: WebSocket;
    url: string;
    onmessageFunc: (event: MessageEvent) => void = () => {};
    constructor(url: string) {
        this.url = url;
        this.socket = new WebSocket(url);
        this.socket.onmessage = (event: MessageEvent) => {
            this.onmessageFunc(event);
        };
    }
    onmessage(callback: (event: MessageEvent) => void) {
        this.onmessageFunc = callback;
    }

    close() {
        this.socket.close();
    }
}

interface Message {
    senderId: number;
    receiverId: number;
    content: string;
    type: number;
}

class PeerConnectionHandler {
    pc?: RTCPeerConnection;
    dataChannel?: RTCDataChannel;
    machineId: number;
    constructor(machineId: number) {
        this.machineId = machineId;
    }

    onicecandidateFunc: (event: RTCPeerConnectionIceEvent) => void = () => {};
    onmessageFunc: (event: MessageEvent, machineId: number) => void = () => {};
    onopenFunc: (event: Event, machineId: number) => void = () => {};
    async initRTCPeerConnection(configuration: RTCConfiguration = {}) {
        this.pc = new RTCPeerConnection(configuration);
        this.pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
            this.onicecandidateFunc(event);
        };
    }

    async initOnDataChannel() {
        if (this.pc) {
            this.pc.ondatachannel = (event: RTCDataChannelEvent) => {
                this.dataChannel = event.channel;
                this.initRTCDataChannelEvents();
            };
        }
    }

    async createDataChannel() {
        if (this.pc) {
            this.dataChannel = this.pc.createDataChannel("chat", {
                ordered: true,
                maxRetransmits: 10,
            });
            this.initRTCDataChannelEvents();
        }
    }

    initRTCDataChannelEvents() {
        if (this.dataChannel) {
            this.dataChannel.onopen = (event: Event) => {
                console.log("Data channel is open");
                this.onopenFunc(event, this.machineId);
            };
            this.dataChannel.onclose = () => {
                console.log("Data channel is closed");
            };
            this.dataChannel.onmessage = (event: MessageEvent) => {
                this.onmessageFunc(event, this.machineId);
            };
        }
    }

    async sendDescription(
        callback: (description: RTCSessionDescription) => void
    ) {
        if (this.pc) {
            await this.pc.setLocalDescription();
            if (this.pc.localDescription) {
                callback(this.pc.localDescription);
            }
        }
    }

    async receiveDescription(remoteDescription: RTCSessionDescription) {
        if (this.pc) {
            await this.pc.setRemoteDescription(remoteDescription);
        }
    }

    async addIceCandidate(candidate: RTCIceCandidate) {
        if (this.pc) {
            this.pc.addIceCandidate(candidate);
        }
    }

    onicecandidate(callback: (event: RTCPeerConnectionIceEvent) => void) {
        this.onicecandidateFunc = callback;
    }

    onopen(callback: (event: Event, machineId: number) => void) {
        this.onopenFunc = callback;
    }

    onmessage(callback: (event: MessageEvent, machineId: number) => void) {
        this.onmessageFunc = callback;
    }

    sendText(data: string) {
        if (this.dataChannel) {
            this.dataChannel.send(data);
        }
    }

    sendBlob(data: ArrayBuffer) {
        if (this.dataChannel) {
            this.dataChannel.send(data);
        }
    }

    bufferedAmountLow() {
        const bufferedAmountLowThreshold = 1024 * 64;
        return new Promise<void>((resolve) => {
            if (this.dataChannel) {
                if (
                    this.dataChannel.bufferedAmount > bufferedAmountLowThreshold
                ) {
                    const handleBufferedAmountLow = () => {
                        this.dataChannel?.removeEventListener(
                            "bufferedamountlow",
                            handleBufferedAmountLow
                        );
                        resolve();
                    };
                    this.dataChannel.addEventListener(
                        "bufferedamountlow",
                        handleBufferedAmountLow
                    );
                    //
                } else {
                    resolve();
                }
            }
        });
    }
}

export { PeerConnectionHandler, SignalingChannel };
export type { Message };
