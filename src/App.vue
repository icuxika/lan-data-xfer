<script setup lang="ts">
import { useFile } from "@/hooks/use-file";
import {
    computed,
    onMounted,
    onUnmounted,
    ref,
    useId,
    useTemplateRef,
    type ComputedRef,
} from "vue";
import {
    PeerConnectionHandler,
    SignalingChannel,
    type Message,
} from "./negotiation";

const { cutFile } = useFile();

let signalingChannel: SignalingChannel;
let currentUserId: number = 0;
const onlineUserIdList = ref<number[]>([]);
const onlineUserOptions: ComputedRef<
    { id: string; text: string; value: number }[]
> = computed(() => {
    return onlineUserIdList.value.map((onlineUserId) => {
        return {
            id: useId(),
            text:
                onlineUserId === currentUserId
                    ? `本机${onlineUserId}`
                    : `其他${onlineUserId}`,
            value: onlineUserId,
        };
    });
});
const onlineUserSelected = ref<number>(0);

const map: {
    [key: number]: PeerConnectionHandler;
} = {};

const connect = async () => {
    const selectedUserId = onlineUserSelected.value;

    const peerConnectionHandler = new PeerConnectionHandler();
    map[onlineUserSelected.value] = peerConnectionHandler;
    peerConnectionHandler.onicecandidate((event) => {
        if (event.candidate) {
            const msg: Message = {
                senderId: currentUserId,
                receiverId: selectedUserId,
                content: JSON.stringify(event.candidate),
                type: 13,
            };
            signalingChannel.socket.send(JSON.stringify(msg));
        }
    });
    await peerConnectionHandler.initRTCPeerConnection();
    peerConnectionHandler.onmessage((event) => {
        onmessage(event);
    });
    await peerConnectionHandler.createDataChannel();
    await peerConnectionHandler.sendDescription((description) => {
        const message: Message = {
            senderId: currentUserId,
            receiverId: selectedUserId,
            content: JSON.stringify(description),
            type: 11,
        };
        signalingChannel.socket.send(JSON.stringify(message));
    });
};
const sendMessage = async () => {
    const data: Data = {
        type: "text",
        content: "hello",
    };
    map[onlineUserSelected.value].sendText(JSON.stringify(data));
};

const fileRef = useTemplateRef("file");
const fileSelected = ref(false);
const sendTextBtnDisabled = ref(false);
const handleFileChange = () => {
    if (fileRef.value && fileRef.value.files) {
        fileSelected.value = fileRef.value.files.length > 0;
    }
};

type Data = {
    type: "text" | "file";
    content: string | FileMetadata;
};

type FileMetadata = {
    name: string;
    size: number;
    totalChunks: number;
};
const progress = ref("");
const sendFile = async () => {
    if (fileRef.value) {
        const fileList = fileRef.value.files;
        if (fileList && fileList.length > 0) {
            sendTextBtnDisabled.value = true;
            const file = fileList[0];
            let chunks = await cutFile(file);
            const metadata: FileMetadata = {
                name: file.name,
                size: file.size,
                totalChunks: chunks.length,
            };
            const data: Data = {
                type: "file",
                content: metadata,
            };
            console.log(metadata);
            map[onlineUserSelected.value].sendText(JSON.stringify(data));
            for (let i = 0; i < chunks.length; i++) {
                await map[onlineUserSelected.value].bufferedAmountLow();
                // 直接传输 blob，即使发送方设置了ordered，接收方也会改变blob消息的顺序
                const arrayBuffer = await chunks[i].blob.arrayBuffer();
                map[onlineUserSelected.value].sendBlob(arrayBuffer);
                progress.value = `进度 ${(((i + 1) / chunks.length) * 100).toFixed(2)}%`;
            }

            const endData: Data = {
                type: "text",
                content: "文件传输完成",
            };
            map[onlineUserSelected.value].sendText(JSON.stringify(endData));
            sendTextBtnDisabled.value = false;
        }
    }
};

const queue: any[] = [];
let isProcessing = false;
let isFileXferring = false;
let metadata: FileMetadata | null;
let receivedChunks: ArrayBuffer[] = [];

const onmessage = (event: MessageEvent) => {
    queue.push(event.data);
    if (!isProcessing) {
        processData();
    }
};

const processData = async () => {
    if (queue.length === 0) {
        isProcessing = false;
        return;
    }
    isProcessing = true;
    const eventData = queue.shift();
    // 当前逻辑暂不支持在传输文件时同步传输文本消息
    if (!isFileXferring) {
        // console.log(typeof eventData === "string");
        const data: Data = JSON.parse(eventData);
        if (data.type === "text") {
            console.log("收到文本消息: ", data.content);
        } else if (data.type === "file") {
            metadata = data.content as FileMetadata;
            console.log("收到文件信息", metadata);
            isFileXferring = true;
        }
    } else {
        // console.log(eventData instanceof ArrayBuffer);
        receivedChunks.push(eventData as ArrayBuffer);
        if (metadata && receivedChunks.length === metadata.totalChunks) {
            const blob = new Blob(receivedChunks);
            console.log("文件传输完成，大小为 ", blob.size);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "x_" + metadata.name;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            receivedChunks = [];
            metadata = null;
            isFileXferring = false;
        }
    }
    processData();
};

onMounted(() => {
    signalingChannel = new SignalingChannel(
        `${import.meta.env.VITE_SIGNALING_SERVER_URL}?token=abc&clientType=1&userId=1`
    );
    signalingChannel.onmessage(async (event) => {
        const message: Message = JSON.parse(event.data);
        switch (message.type) {
            case 0: {
                currentUserId = message.receiverId;
                onlineUserIdList.value = JSON.parse(message.content);
                console.log(
                    `与信令服务器建立连接，得到分配的用户id为${message.receiverId}`
                );
                break;
            }
            case 1: {
                onlineUserIdList.value = JSON.parse(message.content);
                console.log(`在线用户列表已更新`);
                break;
            }
            case 11: {
                const description = JSON.parse(message.content);

                const peerConnectionHandler = new PeerConnectionHandler();
                map[message.senderId] = peerConnectionHandler;
                peerConnectionHandler.onicecandidate((event) => {
                    if (event.candidate) {
                        const msg: Message = {
                            senderId: currentUserId,
                            receiverId: message.senderId,
                            content: JSON.stringify(event.candidate),
                            type: 13,
                        };
                        signalingChannel.socket.send(JSON.stringify(msg));
                    }
                });
                await peerConnectionHandler.initRTCPeerConnection();
                peerConnectionHandler.onmessage((event) => {
                    onmessage(event);
                });
                await peerConnectionHandler.initOnDataChannel();
                await peerConnectionHandler.receiveDescription(description);
                await peerConnectionHandler.sendDescription((description) => {
                    const msg: Message = {
                        senderId: currentUserId,
                        receiverId: message.senderId,
                        content: JSON.stringify(description),
                        type: 12,
                    };
                    signalingChannel.socket.send(JSON.stringify(msg));
                });
                break;
            }
            case 12: {
                const description = JSON.parse(message.content);
                await map[message.senderId].receiveDescription(description);
                break;
            }
            case 13: {
                const candidate = JSON.parse(message.content);
                await map[message.senderId].addIceCandidate(candidate);
                break;
            }
            default: {
                //
            }
        }
    });
});
onUnmounted(() => {
    if (signalingChannel) {
        signalingChannel.close();
    }
});
</script>

<template>
    <div>
        {{ onlineUserIdList }}
        <select v-model="onlineUserSelected">
            <option disabled value="0">请选择目标用户</option>
            <option
                v-for="option in onlineUserOptions"
                :value="option.value"
                :key="option.id"
                :disabled="option.value === currentUserId"
            >
                {{ option.text }}
            </option>
        </select>
        {{ onlineUserSelected }}
        <button
            type="button"
            @click="connect"
            :disabled="onlineUserSelected === 0"
        >
            连接
        </button>
        <button
            type="button"
            @click="sendMessage"
            :disabled="onlineUserSelected === 0 || sendTextBtnDisabled"
        >
            发送文本
        </button>
        <div>
            <input
                type="file"
                name="file"
                ref="file"
                @change="handleFileChange"
            />
            {{ progress }}
            <button
                type="button"
                @click="sendFile"
                :disabled="onlineUserSelected === 0 || !fileSelected"
            >
                发送文件
            </button>
        </div>
        <div style="position: absolute; bottom: 0">
            <a href="https://beian.miit.gov.cn/" target="_blank"
                >豫ICP备17041645号-3</a
            >
        </div>
    </div>
</template>

<style scoped></style>
