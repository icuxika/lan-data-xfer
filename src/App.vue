<script setup lang="ts">
import {
    computed,
    onMounted,
    onUnmounted,
    ref,
    useId,
    type ComputedRef,
} from "vue";
import {
    PeerConnectionHandler,
    SignalingChannel,
    type Message,
} from "./negotiation";
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
    map[onlineUserSelected.value].sendText("hello");
};

const onmessage = async (event: MessageEvent) => {
    console.log(event);
};

onMounted(() => {
    signalingChannel = new SignalingChannel(
        "ws://localhost:5010/websocket?token=abc&clientType=1&userId=1"
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
            <option disabled value="0">Please select one</option>
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
            :disabled="onlineUserSelected === 0"
        >
            发送
        </button>
    </div>
</template>

<style scoped></style>
