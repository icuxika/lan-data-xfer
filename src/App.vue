<script setup lang="ts">
import { useFile } from "@/hooks/use-file";
import { onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import {
    PeerConnectionHandler,
    SignalingChannel,
    type Message,
} from "./negotiation";

const { cutFile } = useFile();

let signalingChannel: SignalingChannel;
const currentUserId = ref<number>(0);

const map: {
    [key: number]: PeerConnectionHandler;
} = {};

const connectMachine = async (selectedUserId: number) => {
    const peerConnectionHandler = new PeerConnectionHandler(selectedUserId);
    map[selectedUserId] = peerConnectionHandler;
    peerConnectionHandler.onicecandidate((event) => {
        if (event.candidate) {
            const msg: Message = {
                senderId: currentUserId.value,
                receiverId: selectedUserId,
                content: JSON.stringify(event.candidate),
                type: 13,
            };
            signalingChannel.socket.send(JSON.stringify(msg));
        }
    });
    await peerConnectionHandler.initRTCPeerConnection();
    peerConnectionHandler.onopen((event, machineId) => {
        onopen(event, machineId);
    });
    peerConnectionHandler.onmessage((event, machineId) => {
        onmessage(event, machineId);
    });
    await peerConnectionHandler.createDataChannel();
    await peerConnectionHandler.sendDescription((description) => {
        const message: Message = {
            senderId: currentUserId.value,
            receiverId: selectedUserId,
            content: JSON.stringify(description),
            type: 11,
        };
        signalingChannel.socket.send(JSON.stringify(message));
    });
};
const input = ref<string>("");
const sendMessage = async () => {
    if (input.value === "") {
        return;
    }
    const data: Data = {
        type: "text",
        content: input.value,
        senderId: currentUserId.value,
    };
    machineList.value
        .filter((p) => p.id === selectedMachineId())[0]
        .messageList.push(data);
    selectedMachineHandler().sendText(JSON.stringify(data));
    input.value = "";
};

const fileRef = useTemplateRef("file");
const fileSelected = ref(false);
const sendTextBtnDisabled = ref(false);
const handleFileChange = () => {
    if (fileRef.value && fileRef.value.files) {
        fileSelected.value = fileRef.value.files.length > 0;
    }
};
const formatBytes = (bytes: number, decimals: number = 2) => {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    // 计算单位索引
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    // 转换为合适的单位
    return (
        parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i]
    );
};

type Data = {
    senderId: number;
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
                senderId: currentUserId.value,
            };
            console.log(metadata);
            machineList.value
                .filter((p) => p.id === selectedMachineId())[0]
                .messageList.push(data);
            selectedMachineHandler().sendText(JSON.stringify(data));
            for (let i = 0; i < chunks.length; i++) {
                await selectedMachineHandler().bufferedAmountLow();
                // 直接传输 blob，即使发送方设置了ordered，接收方也会改变blob消息的顺序
                const arrayBuffer = await chunks[i].blob.arrayBuffer();
                selectedMachineHandler().sendBlob(arrayBuffer);
                progress.value = `进度 ${(((i + 1) / chunks.length) * 100).toFixed(2)}%`;
            }

            const endData: Data = {
                type: "text",
                content: "文件传输完成",
                senderId: currentUserId.value,
            };
            selectedMachineHandler().sendText(JSON.stringify(endData));
            sendTextBtnDisabled.value = false;
        }
    }
};

const onopen = (_event: Event, machineId: number) => {
    machineList.value.filter((p) => p.id === machineId)[0].connected = true;
};

const queue: any[] = [];
let isProcessing = false;
let isFileXferring = false;
let metadata: FileMetadata | null;
let receivedChunks: ArrayBuffer[] = [];

const onmessage = (event: MessageEvent, machineId: number) => {
    queue.push(event.data);
    if (!isProcessing) {
        processData(machineId);
    }
};

const processData = async (machineId: number) => {
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
        machineList.value
            .filter((p) => p.id === machineId)[0]
            .messageList.push(data);

        if (dialogRef.value) {
            selectedMachine.value = machineList.value.filter(
                (p) => p.id === data.senderId
            )[0];
            dialogRef.value.showModal();
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
    processData(machineId);
};

const contentRef = useTemplateRef("content");
const dialogRef = useTemplateRef("dialog");

type MachineInfo = {
    id: number;
    text: string;
    type: number;
    left: string;
    top: string;
    connected: boolean;
    messageList: Data[];
};
const machineList = ref<MachineInfo[]>([]);
const selectedMachine = ref<MachineInfo | null>(null);
const selectedMachineId = (): number => {
    if (selectedMachine.value) {
        return selectedMachine.value.id;
    }
    return 0;
};
const selectedMachineHandler = (): PeerConnectionHandler => {
    return map[selectedMachineId()];
};

const handleMachineClick = async (machine: MachineInfo) => {
    if (machine.connected) {
        if (dialogRef.value) {
            selectedMachine.value = machine;
            dialogRef.value.showModal();
        }
    } else {
        const result = confirm(`确定要连接${machine.text}吗？`);
        if (result) {
            connectMachine(machine.id);
        }
    }
};
const refreshMachines = async (machines: MachineInfo[]) => {
    if (machines.length === 0) {
        return;
    }
    if (contentRef.value) {
        const rect = contentRef.value.getBoundingClientRect();
        const contentWidth = rect.width;
        const contentHeight = rect.height;
        const machinesNumber = machines.length;
        const radius = 280;
        for (let i = 0; i < machinesNumber; i++) {
            const angle = i * ((2 * Math.PI) / machinesNumber);
            const x = Math.cos(angle) * radius + contentWidth / 2;
            const y = Math.sin(angle) * radius + contentHeight / 2;

            machineList.value.push({
                id: machines[i].id,
                text: `${machines[i].id}号`,
                type: machines[i].type,
                left: x - 30 + "px",
                top: y - 30 + "px",
                connected: false,
                messageList: [],
            });
        }
    }
};

onMounted(() => {
    console.log(navigator.userAgent);
    signalingChannel = new SignalingChannel(
        `${import.meta.env.VITE_SIGNALING_SERVER_URL}?token=abc&clientType=1&userId=1`
    );
    signalingChannel.onmessage(async (event) => {
        const message: Message = JSON.parse(event.data);
        switch (message.type) {
            case 0: {
                currentUserId.value = message.receiverId;
                refreshMachines(
                    (JSON.parse(message.content) as number[])
                        .filter((p) => p != currentUserId.value)
                        .map((id) => {
                            return {
                                id,
                                text: "",
                                type: 0,
                                left: "",
                                top: "",
                                connected: false,
                                messageList: [],
                            };
                        })
                );
                console.log(
                    `与信令服务器建立连接，得到分配的用户id为${message.receiverId}`
                );
                break;
            }
            case 1: {
                refreshMachines(
                    (JSON.parse(message.content) as number[])
                        .filter((p) => p != currentUserId.value)
                        .map((id) => {
                            return {
                                id,
                                text: "",
                                type: 0,
                                left: "",
                                top: "",
                                connected: false,
                                messageList: [],
                            };
                        })
                );
                console.log(`在线用户列表已更新`);
                break;
            }
            case 11: {
                const description = JSON.parse(message.content);

                const peerConnectionHandler = new PeerConnectionHandler(
                    message.senderId
                );
                map[message.senderId] = peerConnectionHandler;
                peerConnectionHandler.onicecandidate((event) => {
                    if (event.candidate) {
                        const msg: Message = {
                            senderId: currentUserId.value,
                            receiverId: message.senderId,
                            content: JSON.stringify(event.candidate),
                            type: 13,
                        };
                        signalingChannel.socket.send(JSON.stringify(msg));
                    }
                });
                await peerConnectionHandler.initRTCPeerConnection();
                peerConnectionHandler.onopen((event, machineId) => {
                    onopen(event, machineId);
                });
                peerConnectionHandler.onmessage((event, machineId) => {
                    onmessage(event, machineId);
                });
                await peerConnectionHandler.initOnDataChannel();
                await peerConnectionHandler.receiveDescription(description);
                await peerConnectionHandler.sendDescription((description) => {
                    const msg: Message = {
                        senderId: currentUserId.value,
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
    <div class="container">
        <div style="border: 1px solid dodgerblue">
            <h2>使用说明:</h2>
            <ul>
                <li>
                    1. 局域网下需要传输数据的设备都通过浏览器访问
                    <strong>https://www.aprillie.com/</strong>
                </li>
                <li>
                    2. 中心蓝色圆形代表本机，周围的绿色圆形代表局域网其他设备
                </li>
                <li>
                    3.
                    点击设备建立连接后，对应的绿色圆形会开始产生波纹，此时再次点击则会弹出对话框
                </li>
            </ul>
        </div>
        <div
            style="
                height: 100%;
                position: relative;
                display: flex;
                justify-content: center;
                align-items: center;
            "
            ref="content"
        >
            <div class="current-machine">
                {{ `${currentUserId}号` }}
            </div>
            <div
                v-for="item in machineList"
                :key="item.id"
                class="machine"
                :class="{
                    'machine-connected': item.connected,
                }"
                :style="{
                    left: item.left,
                    top: item.top,
                }"
                @click="handleMachineClick(item)"
            >
                {{ item.text }}
            </div>
            <dialog
                ref="dialog"
                style="
                    width: 60%;
                    left: 50%;
                    top: 50%;
                    transform: translate(-50%, -50%);
                "
            >
                <div style="padding: 64px">
                    <div
                        v-if="selectedMachine"
                        style="
                            height: 240px;
                            border: 2px solid black;
                            overflow: auto;
                            background-color: darkgray;
                            padding: 4px 16px;
                        "
                    >
                        <div
                            v-for="(item, index) in selectedMachine.messageList"
                            :key="index"
                            style="display: flex; padding: 4px 0"
                            :style="{
                                flexDirection:
                                    item.senderId !== currentUserId
                                        ? 'row'
                                        : 'row-reverse',
                            }"
                        >
                            <div
                                class="bubble-message"
                                :class="{
                                    'bubble-message-left':
                                        item.senderId !== currentUserId,
                                    'bubble-message-right':
                                        item.senderId === currentUserId,
                                }"
                            >
                                <p
                                    style="
                                        text-align: left;
                                        white-space: pre-wrap;
                                        word-wrap: break-word;
                                        word-break: break-all;
                                    "
                                >
                                    {{
                                        item.type === "text"
                                            ? item.content
                                            : `文件名: ${(item.content as FileMetadata).name}，文件大小: ${formatBytes((item.content as FileMetadata).size)}`
                                    }}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column">
                        <textarea rows="5" cols="33" v-model="input"></textarea>
                        <button type="button" @click="sendMessage">
                            发送文本
                        </button>
                    </div>
                    <div>
                        <input
                            type="file"
                            name="file"
                            ref="file"
                            @change="handleFileChange"
                        />
                        {{ progress }}
                        <button type="button" @click="sendFile">
                            发送文件
                        </button>
                    </div>
                </div>
            </dialog>
        </div>
        <div
            style="
                position: absolute;
                bottom: 0;
                width: 100vw;
                display: flex;
                justify-content: center;
            "
        >
            <a href="https://beian.miit.gov.cn/" target="_blank"
                >豫ICP备17041645号-3</a
            >
        </div>
    </div>
</template>

<style lang="scss" scoped>
.container {
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.current-machine {
    position: absolute;
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background-color: dodgerblue;
    color: white;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 24px;
    animation: ripple 2s infinite;
}

@keyframes ripple {
    0% {
        box-shadow: 0 0 0 0 dodgerblue;
    }
    100% {
        box-shadow: 0 0 0 50px rgba(0, 0, 0, 0);
    }
}

:deep(.machine) {
    position: absolute;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background-color: forestgreen;
    color: white;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 20px;
}

:deep(.machine-connected) {
    animation: connected-ripple 2s infinite;
}
@keyframes connected-ripple {
    0% {
        box-shadow: 0 0 0 0 forestgreen;
    }
    100% {
        box-shadow: 0 0 0 30px rgba(0, 0, 0, 0);
    }
}

.bubble-message {
    max-width: 80%;
    border-radius: 16px;
    padding: 8px 24px;
    font-size: 16px;
    position: relative;
}

.bubble-message-left {
    $left-color: white;
    color: black;
    background-color: $left-color;
    &::after {
        content: "";
        width: 32px;
        height: 32px;
        background: $left-color;
        mask-repeat: no-repeat;
        mask-size: contain;
        mask-image: url(@/assets/message-decorate-left.svg);

        position: absolute;
        left: 0;
        top: 50%;
        transform: translate(-40%, -50%);
    }
}

.bubble-message-right {
    $right-color: #1772f6;
    color: white;
    background-color: $right-color;
    &::after {
        content: "";
        width: 32px;
        height: 32px;
        background: $right-color;
        mask-repeat: no-repeat;
        mask-size: contain;
        mask-image: url(@/assets/message-decorate-right.svg);

        position: absolute;
        right: 0;
        top: 50%;
        transform: translate(40%, -50%);
    }
}
</style>
