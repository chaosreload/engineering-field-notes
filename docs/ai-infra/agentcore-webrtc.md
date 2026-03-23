# AgentCore WebRTC 双向流：KVS TURN 实时语音 Agent 实战

> 整理日期：2026-03-22
> 原文地址：https://chaosreload.github.io/aws-hands-on-lab/ai-ml/agentcore-webrtc-streaming/
> 参考代码：https://github.com/awslabs/amazon-bedrock-agentcore-samples/tree/main/01-tutorials/01-AgentCore-runtime/06-bi-directional-streaming-webrtc

---

## 项目简介

本 Lab 演示如何将 Amazon Bedrock AgentCore Runtime 的 **WebRTC 双向流**能力与 **Amazon KVS managed TURN** 结合，构建一个支持浏览器实时语音对话的 AI Agent。Agent 后端使用 Nova Sonic 模型处理语音识别和语音生成。

- **难度**：⭐⭐ 中级
- **预估时间**：45 分钟
- **预估费用**：$3-5（含清理）
- **Region**：us-east-1

---

## 核心概念

### WebSocket vs WebRTC

AgentCore Runtime 支持两种双向流协议：

| 维度 | WebSocket | WebRTC |
|------|-----------|--------|
| 传输层 | TCP | UDP |
| 适用场景 | 文本 + 音频流 | 实时音视频 |
| 延迟特性 | 可靠但延迟较高 | 低延迟（容忍丢包）|
| 额外基础设施 | 无 | TURN relay + VPC 模式 |
| 认证方式 | SigV4 / OAuth 2.0 | 通过 TURN credentials |
| 客户端支持 | 需要 SDK | 浏览器原生 API |

**选择建议**：
- 浏览器/移动端实时语音 → **WebRTC**
- 服务端文本或音频流、不想管基础设施 → **WebSocket**

### WebRTC on AgentCore 两个硬性要求

1. **VPC 网络模式**：AgentCore Runtime 必须配置 VPC 模式（PUBLIC 模式不支持 outbound UDP）
2. **TURN relay**：
   - Amazon KVS managed TURN（推荐）— 免运维，IAM 集成
   - 第三方 managed TURN
   - 自建 TURN（coturn）

---

## 系统架构

```
Browser (WebRTC API)
  ↕ UDP/TURN
KVS TURN Relay Server
  ↕ UDP/TURN
AgentCore Runtime (VPC 私有子网)
  → ENI → NAT Gateway → IGW → KVS TURN endpoints
  → Bedrock Nova Sonic (bidirectional stream)
```

### 连接建立流程（4 步）

1. Client 调用 Agent 获取 KVS TURN credentials 和 ICE server 配置
2. Client 创建 WebRTC offer → Agent 创建 peer connection → 返回 answer
3. Client 和 Agent 交换 ICE candidates，通过 TURN server 建立连接
4. 连接建立后，Client 实时发送麦克风音频 → Agent 转发给 Nova Sonic → 语音回复流回 Client

### 项目结构

```
agent/
  bot.py          # FastAPI 服务，WebRTC offer/answer、ICE 处理
  kvs.py          # KVS signaling channel 和 TURN server 管理
  audio.py        # 音频重采样（av）和 WebRTC 输出 track
  nova_sonic.py   # Nova Sonic 双向流 session
  requirements.txt
  Dockerfile
server/
  index.html      # 浏览器客户端（WebRTC + AgentCore Runtime 调用）
  server.py       # 静态文件服务
```

---

## 部署步骤

### Step 1: 创建 VPC 网络环境

AgentCore WebRTC 需要带 NAT Gateway 的 VPC（私有子网通过 NAT Gateway 访问 KVS TURN）：

```bash
export AWS_DEFAULT_REGION=us-east-1

# 创建 VPC
VPC_ID=$(aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=webrtc-agent-vpc}]' \
  --query 'Vpc.VpcId' --output text)

# 创建 IGW + 公共子网（NAT Gateway）
IGW_ID=$(aws ec2 create-internet-gateway --query 'InternetGateway.InternetGatewayId' --output text)
aws ec2 attach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID

PUB_SUBNET=$(aws ec2 create-subnet \
  --vpc-id $VPC_ID --cidr-block 10.0.1.0/24 --availability-zone us-east-1a \
  --query 'Subnet.SubnetId' --output text)

# 创建私有子网（AgentCore ENI）
PRIV_SUBNET=$(aws ec2 create-subnet \
  --vpc-id $VPC_ID --cidr-block 10.0.2.0/24 --availability-zone us-east-1a \
  --query 'Subnet.SubnetId' --output text)

# 创建 NAT Gateway
EIP_ID=$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text)
NAT_ID=$(aws ec2 create-nat-gateway \
  --subnet-id $PUB_SUBNET --allocation-id $EIP_ID \
  --query 'NatGateway.NatGatewayId' --output text)
aws ec2 wait nat-gateway-available --nat-gateway-ids $NAT_ID

# 路由表：公共子网 → IGW；私有子网 → NAT
# （详细命令见原文）

# 创建安全组
SG_ID=$(aws ec2 create-security-group \
  --group-name webrtc-agent-sg \
  --description "WebRTC agent - allow all outbound for TURN" \
  --vpc-id $VPC_ID --query 'GroupId' --output text)

echo "VPC=$VPC_ID PRIV_SUBNET=$PRIV_SUBNET SG=$SG_ID"
```

### Step 2: 克隆示例代码

```bash
git clone --depth 1 https://github.com/awslabs/amazon-bedrock-agentcore-samples.git
cd amazon-bedrock-agentcore-samples/01-tutorials/01-AgentCore-runtime/06-bi-directional-streaming-webrtc
```

> **⚠️ Docker Hub 限速**：遇到 429 Too Many Requests 时，修改 `agent/Dockerfile` 第一行：
> ```
> FROM public.ecr.aws/docker/library/python:3.12-slim
> ```

### Step 3: 配置并部署 Agent（VPC 模式）

```bash
pip install bedrock-agentcore-starter-toolkit

cd agent

agentcore configure \
  -e bot.py \
  --deployment-type container \
  --disable-memory \
  --vpc \
  --subnets $PRIV_SUBNET \
  --security-groups $SG_ID \
  --non-interactive

agentcore deploy \
  --env KVS_CHANNEL_NAME=voice-agent-webrtc \
  --env AWS_REGION=us-east-1
```

部署约 1-2 分钟，记下输出的 Agent ARN。

### Step 4: 附加 IAM 权限

```bash
ROLE_NAME=AmazonBedrockAgentCoreSDKRuntime-us-east-1-xxxxxxxxxx

# KVS TURN 访问
aws iam put-role-policy --role-name $ROLE_NAME --policy-name kvs-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Action": [
      "kinesisvideo:DescribeSignalingChannel",
      "kinesisvideo:CreateSignalingChannel",
      "kinesisvideo:GetSignalingChannelEndpoint",
      "kinesisvideo:GetIceServerConfig"
    ], "Resource": "arn:aws:kinesisvideo:us-east-1:*:channel/*"}]
  }'

# Bedrock Nova Sonic
aws iam put-role-policy --role-name $ROLE_NAME --policy-name bedrock-nova-sonic \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow",
      "Action": "bedrock:InvokeModelWithBidirectionalStream",
      "Resource": "arn:aws:bedrock:us-east-1:*:foundation-model/*"}]
  }'
```

### Step 5: 验证 + 浏览器测试

```bash
# 检查状态
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id $AGENT_ID --region us-east-1 \
  --query '{status:status,arn:agentRuntimeArn}'
# → "status": "READY"

# 测试获取 ICE config
aws bedrock-agentcore invoke-agent-runtime \
  --agent-runtime-arn "$AGENT_ARN" \
  --runtime-session-id "$SESSION_ID" \
  --content-type "application/json" \
  --accept "application/json" \
  --payload $(echo -n '{"action":"ice_config"}' | base64) \
  --region us-east-1 /tmp/ice-response.json

# 启动浏览器客户端
cd ../server
python server.py  # http://localhost:7860
```

---

## 端到端 Python WebRTC 验证

用 Python 客户端替代浏览器，完整验证语音收发：

```python
# 依赖
pip install edge-tts aiortc aiohttp av

# 核心流程：
# 1. edge-tts 生成中文问题 MP3 → 转为 16kHz/16-bit/mono PCM
# 2. FileAudioTrack 按 20ms 帧率实时发送
# 3. 信令：ice_config → createOffer → setLocal → invoke(offer) → setRemote
# 4. AudioRecorder 录制响应，检测非静音帧（振幅阈值 > 100）
```

关键代码片段：

```python
class FileAudioTrack(MediaStreamTrack):
    kind = "audio"
    async def recv(self):
        frame_bytes = 320 * 2  # 16kHz * 20ms * 16bit
        chunk = self._pcm_data[self._offset:self._offset + frame_bytes]
        # 按实时节奏返回 AudioFrame

# 信令流程
ice_response = invoke_agent(session, agent_arn, session_id, {"action": "ice_config"})
pc = RTCPeerConnection(RTCConfiguration(iceServers=ice_servers))
pc.addTrack(FileAudioTrack("/tmp/question.wav"))
offer = await pc.createOffer()
await pc.setLocalDescription(offer)
answer = invoke_agent(session, agent_arn, session_id, {
    "action": "offer",
    "data": {"sdp": offer.sdp, "type": offer.type, "turnOnly": True}
})
await pc.setRemoteDescription(RTCSessionDescription(**answer))
```

> **注意**：boto3 的 `invoke_agent_runtime` 的 `payload` 接受 raw bytes（不是 base64），响应在 `response` 字段（不是 `body`）。

---

## 性能数据

### AgentCore Runtime 调用延迟

| 指标 | 冷启动（新 Session）| 热调用（同 Session）|
|------|------------------|------------------|
| 平均延迟 | 8,747ms | 1,394ms |
| 最小延迟 | 8,672ms | 1,380ms |
| 最大延迟 | 8,855ms | 1,410ms |

- **冷启动 ~8.7s**：包含容器初始化 + VPC ENI 分配（VPC 模式固定开销）
- **热调用 ~1.4s**：包含 KVS GetIceServerConfig API 调用
- 实际语音对话：WebRTC 音频走 UDP 直连，延迟远低于 API 调用

### Python 客户端端到端测试

| 指标 | 值 |
|------|-----|
| ICE config 延迟 | 1.21s |
| SDP 交换延迟 | 0.90s |
| WebRTC 连接建立 | 1.50s |
| 发送音频时长 | 2.88s |
| 接收响应时长 | 37.01s |
| 首个响应音频 | 连接建立后 < 0.1s |

### KVS TURN Server 配置

| 参数 | 值 |
|------|-----|
| TURN 服务器数量 | 2（高可用）|
| 每个服务器 URL 数 | 3（TURN UDP / TURNS UDP / TURNS TCP）|
| Credential TTL | 300 秒（5 分钟）|
| 端口 | 443（统一，防火墙友好）|

### 音频参数

| 参数 | 值 |
|------|-----|
| 输入采样率 | 16kHz |
| 输出采样率 | 24kHz |
| 格式 | 16-bit PCM mono |
| 模型 | amazon.nova-2-sonic-v1:0 |
| 语音 | matthew |
| WebRTC 帧大小 | 20ms |

---

## 踩坑记录

**踩坑 1: Docker Hub Rate Limit**
- CodeBuild 默认从 docker.io 拉取，频繁构建触发 429
- ✅ 解决：`FROM public.ecr.aws/docker/library/python:3.12-slim`

**踩坑 2: Nova Sonic Region 可用性**
- `amazon.nova-2-sonic-v1:0` 并非所有 Region 可用，ap-southeast-1 不可用，us-east-1 可用
- ✅ 解决：先 `aws bedrock list-foundation-models` 确认，AgentCore 和 Bedrock FM 可用性需分别确认

**踩坑 3: Agent 更新冲突**
- `agentcore deploy` 默认不覆盖已有 Agent，需加 `--auto-update-on-conflict`
- Agent 处于 CREATING/UPDATING 状态时更新会失败，需等 READY

**踩坑 4: Session ID 长度限制**
- `runtimeSessionId` 最少 33 个字符，UUID（36 字符）可满足

**踩坑 5: TURN Forbidden IP 警告**
- aioice 报 `STUN transaction failed (403 - Forbidden IP)` 不影响功能
- 连接通过 Send Indication 方式仍成功建立

---

## 清理资源

```bash
# 1. 销毁 Agent
agentcore destroy

# 2. 删除 KVS Signaling Channel
CHANNEL_ARN=$(aws kinesisvideo describe-signaling-channel \
  --channel-name voice-agent-webrtc \
  --query 'ChannelInfo.ChannelARN' --output text)
aws kinesisvideo delete-signaling-channel --channel-arn $CHANNEL_ARN

# 3. 检查 ENI 残留（VPC 模式 ENI 可能保持最长 8 小时）
aws ec2 describe-network-interfaces \
  --filters "Name=group-id,Values=$SG_ID" \
  --query 'NetworkInterfaces[].{Id:NetworkInterfaceId,Status:Status}'

# 4. 删除 VPC 资源（按依赖顺序：NAT GW → EIP → Subnet → Route Table → IGW → SG → VPC）
aws ec2 delete-nat-gateway --nat-gateway-id $NAT_ID
aws ec2 wait nat-gateway-deleted --nat-gateway-ids $NAT_ID
aws ec2 release-address --allocation-id $EIP_ID
# ... 依次删除 subnet、route table、igw、sg、vpc
```

> ⚠️ **务必清理**：NAT Gateway $0.045/hr ≈ $32/月，忘记清理会持续扣费！

---

## 费用明细（参考）

| 资源 | 费用 |
|------|------|
| NAT Gateway（2h）| $0.09 |
| AgentCore Runtime 调用 | ~$1.00 |
| Bedrock Nova Sonic | ~$0.50 |
| KVS Signaling Channel | ~$0.00 |
| **合计** | **~$1.60** |

---

## 关键发现 / 学习心得

1. **WebRTC 的本质额外成本**：选 WebRTC 就是选低延迟 + 浏览器原生，但必须接受 VPC 模式（冷启动 +8.7s）+ TURN 基础设施的代价。不是所有场景都值得。

2. **KVS managed TURN 是最佳选择**：免运维、IAM 集成、高可用（2个服务器）、防火墙友好（443 端口），基本没有理由自建 coturn。

3. **TURN Credential TTL 是隐患**：仅 5 分钟，生产环境必须实现客户端定时刷新机制，否则长时间连接会断开。

4. **冷启动优化策略**：~8.7s 冷启动只发生在第一次连接，后续语音传输走 UDP 直连不经 AgentCore API，实际对话体验不受影响。生产环境可通过 keep-alive 保持 session 活跃来缓解。

5. **aiortc 实现细节**：Python 端的 boto3 payload 是 raw bytes 而不是 base64，这与 CLI 行为不一致，是个容易踩的坑。

---

## 参考资源

- [Bidirectional streaming with WebRTC — 官方文档](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-webrtc.html)
- [Tutorial: WebRTC with KVS TURN — 官方教程](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-webrtc-get-started-kvs.html)
- [Configure AgentCore for VPC — 官方文档](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-vpc.html)
- [完整示例代码 — GitHub](https://github.com/awslabs/amazon-bedrock-agentcore-samples/tree/main/01-tutorials/01-AgentCore-runtime/06-bi-directional-streaming-webrtc)
- [KVS GetIceServerConfig API](https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/API_signaling_GetIceServerConfig.html)
