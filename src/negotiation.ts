enum MessageType {
    /**
     * 建立连接
     */
    AFTER_CONNECTION_ESTABLISHED = 0,
    /**
     * 更新在线用户列表
     */
    UPDATE_ONLINE_USER = 1,
    /**
     * 发送本地描述
     */
    SEND_LOCAL_DESCRIPTION = 11,
    /**
     * 接收本地描述
     */
    RECEIVE_LOCAL_DESCRIPTION = 12,
    /**
     * 传递 ICE 候选者
     */
    SEND_CANDIDATE = 13,
}

type SignalingChannelOptions = {
    reconnectInterval?: number;
    reconnectAttempts?: number;
    onMessage?: (event: MessageEvent) => void;
    onOpen?: (event: Event) => void;
    onError?: (event: Event) => void;
    onClose?: (event: CloseEvent) => void;
};

class SignalingChannel {
    socket: WebSocket | null;
    url: string;
    options: SignalingChannelOptions;
    reconnectInterval: number;
    reconnectAttempts: number;
    reconnectCount: number;
    onOpen: (event: Event) => void;
    onMessage: (event: MessageEvent) => void;
    onError: (event: Event) => void;
    onClose: (event: CloseEvent) => void;
    constructor(url: string, options: SignalingChannelOptions) {
        this.socket = null;
        this.url = url;
        this.options = options;
        this.reconnectInterval = options.reconnectInterval || 5000;
        this.reconnectAttempts = options.reconnectAttempts || 3;
        this.reconnectCount = 0;
        this.onOpen = options.onOpen || (() => {});
        this.onMessage = options.onMessage || (() => {});
        this.onError = options.onError || (() => {});
        this.onClose = options.onClose || (() => {});

        this.connect();
    }

    connect() {
        this.socket = new WebSocket(this.url);
        this.socket.onopen = () => {
            this.reconnectCount = 0;
        };
        this.socket.onmessage = (event: MessageEvent) => {
            this.onMessage(event);
        };
        this.socket.onclose = (event: CloseEvent) => {
            this.onClose(event);
            if (this.reconnectCount < this.reconnectAttempts) {
                setTimeout(() => {
                    this.reconnectCount++;
                    this.connect();
                }, this.reconnectInterval);
            }
        };
        this.socket.onerror = (event: Event) => {
            this.onError(event);
            this.socket?.close();
        };
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(data);
        } else {
            console.error("WebSocket is not open.");
        }
    }

    close() {
        this.socket?.close();
    }
}

interface Message {
    senderId: number;
    receiverId: number;
    content: string;
    type: MessageType;
}

type PeerConnectionHandlerOptions = {
    onOpen?: (event: Event, machineId: number) => void;
    onIceCandidate?: (event: RTCPeerConnectionIceEvent) => void;
    onMessage?: (event: MessageEvent, machineId: number) => void;
};

class PeerConnectionHandler {
    pc: RTCPeerConnection | null;
    dataChannel: RTCDataChannel | null;
    machineId: number;
    onOpen: (event: Event, machineId: number) => void;
    onIceCandidate: (event: RTCPeerConnectionIceEvent) => void;
    onMessage: (event: MessageEvent, machineId: number) => void;
    constructor(machineId: number, options: PeerConnectionHandlerOptions) {
        this.pc = null;
        this.dataChannel = null;
        this.machineId = machineId;
        this.onOpen = options.onOpen || (() => {});
        this.onIceCandidate = options.onIceCandidate || (() => {});
        this.onMessage = options.onMessage || (() => {});
    }

    async initRTCPeerConnection(configuration: RTCConfiguration = {}) {
        this.pc = new RTCPeerConnection(configuration);
        this.pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
            this.onIceCandidate(event);
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
                console.log(`与[${this.machineId}]之间的数据通道已经打开`);
                this.onOpen(event, this.machineId);
            };
            this.dataChannel.onclose = () => {
                console.log(`与[${this.machineId}]之间的数据通道已经关闭`);
            };
            this.dataChannel.onmessage = (event: MessageEvent) => {
                this.onMessage(event, this.machineId);
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

export { MessageType, PeerConnectionHandler, SignalingChannel };
export type { Message };
