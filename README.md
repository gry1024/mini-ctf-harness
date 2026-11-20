# mini-ctf-harness

本地模型 CTF 解题终端，基于 Pi Agent Core 与 Pi TUI。每题使用独立 Docker 工具容器，支持多题队列、后台命令、人工判题、技能读取和保持前缀的 Compact。

## 安装并运行

支持原生 x86-64 Ubuntu 24.04，以及 Windows 11 + WSL2 Ubuntu 22.04/24.04。系统需有 Python 3.10+、Git、启用 systemd 和 NVIDIA 驱动。WSL 使用 Windows CUDA 引擎；原生 Ubuntu 使用 Linux CUDA 引擎。

WSL 使用 Windows CUDA 服务时，请先在 `%UserProfile%\.wslconfig` 配置以下网络模式，并重新启动 WSL。这样前端可通过 `127.0.0.1` 连接 Windows 服务，配置依据见 [Microsoft WSL 网络文档](https://learn.microsoft.com/en-us/windows/wsl/networking#mirrored-mode-networking)。

```ini
[wsl2]
networkingMode=mirrored
```

将仓库放在准备使用的磁盘，然后执行：

```bash
git clone https://github.com/MingASA/mini-ctf-harness.git
cd mini-ctf-harness
./mini-ctf install --data-dir /path/to/mini-ctf-data --model qwen3.8-27b-iq4xs
./mini-ctf
```

`--data-dir` 换成你的数据目录。WSL 请指定 Windows 数据盘上的路径，例如 `/mnt/d/mini-ctf-data`。安装器把权重、引擎、下载缓存和容器数据放在那里；需要 Linux 文件系统时自动建立本安装专用的稀疏 ext4 镜像。原生 Linux 可使用任意有足够空间的本地目录。首次安装联网下载依赖、构建工具镜像，之后启动直接复用。

另一台机器或云端推送新版本后，本机在仓库目录执行：

```bash
./mini-ctf update
./mini-ctf
```

更新命令只接受 Git 快进更新，保留数据目录中的权重、引擎、题目记录、配置和 Docker 数据。普通前端、提示词和 Skill 更新拉取后直接可用；仅当依赖锁或工具镜像定义变化时才刷新对应部分，新增的固定模型资产只下载一次。更新不会结束驻留模型或正在运行的前端；要使用新代码时退出旧前端后重新执行 `./mini-ctf`，已加载且配置未变的模型由启动器复用。

安装命令会完成：

- 校验并下载固定版本的 27B、9B CTF 权重、两套视觉 projector、llama.cpp 与 CUDA 运行库；支持断点续传。
- 准备 Node 22、固定 npm 依赖、独立 Docker Engine、Buildx 和 Compose；Windows 缺失 VC 运行库时一并安装。
- 构建含 Python、pwntools、z3、sympy、Crypto、gdb、binutils、curl、nmap 等工具的容器镜像。
- 生成可编辑的 `config.json`；每次启动自动加载模型并准备工具环境。

同样可以在安装好 Harness 后，用一条命令安装模型和相关依赖：

```bash
./mini-ctf model install qwen3.8-27b-iq4xs --data-dir /path/to/mini-ctf-data
```

安装前查看下载清单和步骤：

```bash
./mini-ctf install --plan --data-dir /path/to/mini-ctf-data
```

原生 Linux 首次安装使用 sudo；WSL 通过当前发行版的 root 入口准备本安装的 Docker 和存储。驱动及 WSL 的安装涉及系统重启，由操作者预先完成。

## 固定模型版本与配置

默认权重是 [Unsloth Qwen3.8-27B UD-IQ4_XS](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/tree/4ca720788d1e01f1bff70c033e0d0028fd02e502)，revision `4ca720788d1e01f1bff70c033e0d0028fd02e502`，14.25 GB，SHA256：

```text
40fac4050e940397dbf13087afd50f4734a11805bf9d65ef8ddd7483470e6199
```

同时安装 [Qwen3.5 9B CTF Web Q8](https://huggingface.co/chinatigerking/qwen3.5-9B-ctf-web-instruct/tree/f08b567d5e69917787953d5302093de5d1ab8a2d)，固定 revision `f08b567d5e69917787953d5302093de5d1ab8a2d`，SHA256：

```text
de632c79cb58be69c4685967e114a329fd819ba6fb9e87c1c79843dc7a2e73bd
```

推理引擎固定为 [llama.cpp b12144](https://github.com/ggml-org/llama.cpp/releases/tag/b12144)。全部下载地址、大小和哈希在 [installer/assets.json](installer/assets.json)。可复用已有资产：`--model-file`、`--projector-file`、`--qwen35-model-file`、`--qwen35-projector-file`、`--runtime-exe`、`--docker`、`--dockerd`、`--docker-host`、`--solver-image`；所有模型文件仍校验固定大小与 SHA256。

安装后 `/model` 中有四项：`qwen3.8-27b-iq4xs`、`qwen3.8-27b-iq4xs-vision`、`qwen3.5-9b-ctf-web-q8`、`qwen3.5-9b-ctf-web-q8-vision`。默认仍启动 27B 文本版；切换模型时会重新加载权重，视觉项同时加载相应 F16 projector。已有的额外模型配置会随重新安装保留。

在终端选择视觉型号时，可选 CPU（使用系统内存）或 GPU（使用显存）。也可以直接指定 `/model qwen3.5-9b-ctf-web-q8-vision gpu`，或在启动命令中传入 `--model qwen3.5-9b-ctf-web-q8-vision --projector-device gpu`。启动时省略此参数会使用已保存的选择，首次使用默认 CPU。视觉配置也接受 `"projectorDevice": "cpu"` 或 `"gpu"`。

默认是 16 GB 显存配置：55,296 上下文、Q8 KV、单槽、无 MTP；普通生成 medium、总输出 8K；40K 软 Compact，Compact 默认关闭思考，单次总输出上限为 8K。硬件不同可修改数据目录的 `config.json` 中 `contextTokens`、`compactSoftTokens`、`gpuLayers`、`kvType` 等参数。两套权重和 projector 约 26 GB；连同引擎、下载缓存、工具镜像和可增长的 ext4 工作区，建议数据盘至少预留 55 GB。

Thinking 采样 `temperature=1.0, top_p=0.95, top_k=20`；Non-thinking 为 `0.7, 0.80, 20`。内置 15 个原始 SKILL.md 与 32 个 References；Pi 直接发现 `.agents/skills/`，按需使用通用 `read` 读取。

## Offline knowledge in the main session

When you run `./mini-ctf`, the model in the competition session has access to the `knowledge` tool. The tool supports `search`, `browse`, and `get`. Calls and results stay in the current task conversation and logs. The non-interactive `./mini-ctf run` entry point uses the same tool.

The model starts with what it already knows and the evidence in the task. It can look up a fact when a key detail is uncertain, an observation contradicts its understanding, or repeated attempts have stalled and an assumption needs checking. A specific gap can prompt an immediate lookup. The model reviews summaries first, reads a single card if it needs more detail or qualifications, then returns to the task to verify what it learned. The prompt guides that choice, and the harness executes the resulting tool call.

For example, to check how PNG IDAT works, the model can call `{"op":"search","query":"IDAT"}` for the top three summaries, then use `{"op":"get","id":"formats/png/idat-stream"}` to read that card's details, qualifications, and sources. Each call returns at most five summaries or directory entries. The `get` operation accepts one registered ID. Browsing supports `scope`, category `tag`, and pagination with `offset`.

The startup prompt includes instructions for using the tool. Individual cards enter the model context through tool results as needed. The reference files ship with the repository, and the process builds the index on the first lookup. Retrieval works offline. Restart the frontend after editing cards to load the updated content. Lookups use the existing tool logs and session restore mechanism, so previously retrieved results remain available when you reopen a task.

The catalog contains 157 cards across 44 technology scopes. A card can apply to several categories while retaining a single ID.

| Category tag | Card count (including shared tags) | Example topics |
|---|---:|---|
| web | 35 | HTTP redirects and partial responses, cookie scope, Flask sessions and repeated parameters, SQLite types and NULL, PHP version differences |
| reverse | 60 | x86-64 and AArch64 semantics, SysV and Windows calling conventions, PE, ELF, DEX, JVM, Wasm, and fixed-width arithmetic |
| pwn | 20 | C object bounds and lifetime, struct layout, stack unwinding, debug symbols, fault addresses, and dump interpretation |
| crypto | 25 | Modular arithmetic, elliptic curve group law and compressed points, finite fields, corrupted shares, integer lattices and LLL, and cryptographic data representation |
| misc | 89 | ext4, Windows minidumps, image metadata, telephone dual tones, compressed archives, PDF, SQLite, and packet captures |

To check references manually, run `./mini-ctf knowledge search "question"`, `./mini-ctf knowledge browse --tag pwn`, or `./mini-ctf knowledge get ID`. The standalone reader also supports `ask --model MODEL_ID` and the plain chat mode `ask --text-only --model MODEL_ID`. Set the model server URL with `MINI_CTF_KNOWLEDGE_MODEL_URL`.

The retrieval tests include one query per card, 20 additional paraphrases, and ten knowledge questions tied to offline artifacts, two per category. They measure whether the expected card is retrieved. Evaluate the final task answer and the model's solving accuracy separately.

Each file under `knowledge/<category>/<technology>/*.json` describes one verifiable fact. The path and filename form its stable ID. For new cards, state the fact in `summary` and use `applies`, `detail`, and `boundary` to capture version constraints, prerequisites, and exceptions. Link the defining specification or manual in `sources.reference`, and document the connection to the task in `sources.context` and `relevance`. Add a realistic query and its expected card ID, then run `node --test offline_harness/test/knowledge.test.mjs`. To check the PHP examples on 64-bit PHP 7.4 or 8.x with the JSON extension loaded, run `php -d zend.assertions=1 -d assert.exception=0 -d assert.warning=0 offline_harness/test/fixtures/knowledge-php.php`.

## 交互

```text
Ctrl+N       新建题目，粘贴题意、选择附件、填写目标地址
/queue       查看所有题目、后台任务、待人工确认的答案
/view 02     直接查看第 02 题的输出
/delete 02   删除指定会话、解题容器和工作目录；省略题号时弹出会话选择
/resume 02   恢复第 02 题；/resume 可先选题
/review      选择候选并记录平台通过或错误
/model       选择模型；/model 编号或ID 直接切换
/effort      选择正常推理或 Compact 压缩，分别设置思考开关、强度和 token 预算
/env         选择新题环境；/tab 选择面板
/compact     当前完整轮次结束后压缩
/context     输入当前会话的窗口和软压缩线，也可直接输入 /context 64K 48K
/tool 3      查看当前题的第 3 条工具结果；/tab output 返回对话
Ctrl+C       停止生成，保留内容、后台命令及驻留模型；输入消息或 /resume 继续
/quit        保存并退出前端
```

输入 `/` 可查看命令及右侧的用途说明。用 ↑↓ 选择，Enter 确认，Esc 取消。选择「自定义上限」可直接输入思考 token 数。 `/priority` 打开数值输入框，`/offloadKV config` 先选择内存配置项，再输入 MiB。

新建题目第 3 步可输入单个文件或目录的绝对路径。WSL 支持直接粘贴 Windows 盘符路径（如 C:\Users\me\Downloads\sample.zip），也支持 Linux 路径。目录按原层级递归复制到题目的 /work/attachments，单个文件只复制该文件。也可用 /browse 选择，或输入 - 跳过。

题号从 `01`、`02`、`03` 递增；已有会话使用同样的短编号，原始记录保持完整。状态栏累计显示模型调用次数与已生成 tokens，并显示当前上下文、软压缩线及总窗口刻度。上下文使用最近一次原生计数和该次生成量，Compact 后使用重建后的计数。

`/context 64K 48K` 将当前会话窗口设为 65,536 tokens，自动压缩线设为 49,152 tokens。窗口上限取自后端启动配置。已有对话在下一个轮次边界按实际 token 数校验，必要时先在原窗口压缩。输入 `/tab budget` 可以查看当前值、待应用值或失败原因。设置随会话保存，切换模型后使用所选模型的预算。

工具接口保持简短：

```json
run_command({"command":"python3 solve.py"})
wait_job({"job_id":"j1"})
read({"path":"/work/result.txt"})
submit_flag({"candidate":"flag{...}"})
```

命令先等待最多 15 秒；未结束则给出 job ID，模型自行选择后续动作。每次 `wait_job` 最多等待 120 秒，仍在运行就提醒，后台继续执行。终端对话用青色标记「模型思考」，绿色标记「正式回复」，黄色标记工具调用和结果。长工具结果只显示开头，按提示输入 `/tool 序号` 查看该条结果。有输出归档时，可从详情中找到完整文件路径。工具连接异常会显示简短原因，完整诊断保存在本机日志。

默认人工判题：`submit_flag` 保存候选并返回 `awaiting_review`，在 `/review` 中录入结果。`/start` 开启调度。每题的对话、工具结果、预算和检查点独立保存。页首显示源码提交号，启动身份保存在会话目录 `startups/` 中。

### 暂停与 RAM KV

同一题暂停后直接恢复时，后端会尝试复用当前推理槽中的前缀。另一题用过该槽后，`/resume` 根据保存的对话重新送入前缀。

启用后，`/offloadKV` 暂停驻留题并把 KV 快照放到本机 `/dev/shm`。成功后用 `/resume 题号` 选择要跑的题。恢复原题时，后端用快照匹配文本和图片前缀，并处理未命中的后缀。快照在成功回读后释放，重启系统或关闭 WSL 后也会随 tmpfs 消失。原对话仍可恢复。

在 `config.json` 的 `modelRuntime` 下添加 `"ramKv": {}`，再启动托管引擎。支持内置 27B 和 9B、54K 以内的 Q8 KV。Windows 引擎在数据盘临时序列化，每次操作结束后删除中转文件。默认中转位置是引擎运行目录下的 `slot-staging`，可通过 `ramKv.stagingRoot` 指定其他 Windows 数据盘位置。原生 Linux 直接写 tmpfs。

RAM 检查取 Windows 和 WSL 可用内存中较低的一项，并检查 tmpfs 的实际空间。默认保留系统内存 `reserveMiB: 2048`，CPU projector 额外保留 `cpuProjectorReserveMiB: 1280`，另留 512 MiB 给序列化。`maxCacheMiB` 限制该安装中所有快照的总量。实际可缓存量随 Windows、WSL 和 tmpfs 当时的余量变化。WSL 的内存上限可在 WSL Settings 中调整。 [Microsoft WSL 配置](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)

32 GB 机器可把下面的对象合并到已有的 `modelRuntime`，保留其中的引擎路径。

```json
{
  "ramKv": {
    "reserveMiB": 4096,
    "cpuProjectorReserveMiB": 1536,
    "maxCacheMiB": 6144
  }
}
```

在终端运行 `/offloadKV config` 查看当前值并选择要调整的余量或缓存上限。也可以直接设置，例如 `/offloadKV config reserveMiB=4096 cpuProjectorReserveMiB=1536 maxCacheMiB=6144`。可以只改一项，输入 `default` 可恢复该项的配置文件值或内置默认值。设置保存在当前安装的会话目录，从下一次 KV 操作生效。降低上限会限制新保存，已有快照仍可回读。

默认速度参数来自 5060 Ti + Windows/WSL 测试。换机器后，可在 `ramKv.profiles` 以模型 ID 分别设置速度。`roundTripMiBps` 取快照大小除以保存、复制和回读的总耗时，`prefillTokensPerSecond` 取冷前缀速度，`cpuImageSeconds` 取一张图片的 CPU 编码耗时，`admissionSeconds` 计入内存与槽位检查的固定时间。收益小、内存不足或快照已失效时，恢复使用原对话。

在这台机器上，约 24.6K 纯文本前缀的冷算和 RAM 路径分别是 27B 的 52.0 秒和 20.3 秒，以及 9B 的 21.8 秒和 9.0 秒。对计时样本插值，仅比较模型与文件操作，纯文本约在 27B 5K、9B 3.5–4K 开始占优。实测三次 Windows 内存检查合计约 6 秒。计入检查、共享前缀和余量后，Windows 默认大约从 27B 13K 和 9B 18K 起保存纯文本前缀。CPU 编码的图片可在较短的前缀中获得收益。

## Web 环境

已有内网目标：

```bash
./mini-ctf --target http://192.168.1.20:8000
```

也可在新题表单中填写目标。工具容器会使用受限的内网访问规则。

本地 Compose 题目：在 `config.json` 的 `environments` 中添加环境，例如：

```json
{
  "local-web": {
    "type": "internal",
    "network": "mini-ctf-web",
    "subnet": "172.28.248.0/24",
    "targetUrl": "http://172.28.248.10:8000",
    "composeFile": "/absolute/path/to/challenge/compose.yaml"
  }
}
```

`./mini-ctf --env local-web` 会启动对应 Compose 并预填目标地址。题目镜像需提前拉取或导入；正式解题时使用本地镜像。可添加 `imageArchives` 数组，由启动器导入离线镜像。

Compose 描述的是独立运行的题目服务，例如一个 HTTP 应用和它的数据库。普通附件题由工具容器执行命令，不需要 Compose。给工具容器增加通用依赖时，在 `docker/Dockerfile` 中维护系统包，在 `docker/requirements.txt` 中固定 Python 包版本，然后在联网准备阶段构建新版镜像。运行中的离线容器继续使用创建时指定的镜像。

工具镜像包含 cpio、7z、xz、zstd 等归档工具，以及 binwalk、foremost、exiftool、steghide、zsteg、YARA、ImageMagick、FFmpeg、PDF 和 Office 分析工具。取证工具包括 Volatility 3 和 Sleuth Kit。二进制分析和兼容工具包括 gdb-multiarch、radare2、Ghidra headless、jadx、QEMU user、MinGW、apktool 和 Wine 32/64。系统工具优先使用 Debian Bookworm 官方包，其余上游发布包固定版本和 SHA256。Wine 状态保存在题目工作目录的 `.wine` 中。

解题容器默认内存上限为 2048 MiB，可在 `config.json` 的 `solver.memoryMiB` 中设置为 128–4096 MiB；复杂分析和多个并发题目会相应占用更多内存。容器以工作目录所属用户运行，保留只读根文件系统、能力丢弃和网络隔离。

构建后可以在受限容器中检查基础工具和归档往返（将 `IMAGE` 替换为待检查的镜像 ID）：

```sh
smoke_work=$(mktemp -d)
docker run --rm -i --pull=never --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user "$(id -u):$(id -g)" --memory 2g --pids-limit 128 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m --mount "type=bind,src=$smoke_work,dst=/work" \
  IMAGE sh -s < docker/smoke-test.sh
```

测试结束后可删除 `smoke_work` 指向的临时目录；Wine 初始化文件保存在该目录中。

## 验证范围

Windows + WSL 的真实 27B 加载、工具执行、候选提交与人工确认流程已验收。原生 Linux 已通过自动测试和真实进程启动/替换测试；Linux CUDA 推理尚未做 GPU 实机验收。

## 测试与目录

```bash
cd offline_harness
npm test
python3 -m unittest discover -s ../installer/test
```

`offline_harness/src/` 是运行时，`prompts/` 是普通解题和 Compact 提示词，`installer/` 管理安装及校验，`docker/` 定义工具环境。模型权重、运行记录、用户配置和依赖目录保存在本机并由 Git 忽略。

依赖 Pi、llama.cpp、Docker、Node.js 和模型各自的上游许可；下载的模型权重遵循模型发布方的许可。

## 斜杠命令速查

输入 `/` 可浏览命令，按 Enter 确认，Esc 取消。下表中方括号表示可选参数。

| 命令 | 用途 |
| --- | --- |
| `/new` | 新建会话，依次填写标题、题意、附件和可选目标。 |
| `/view [题号]` | 查看指定会话。省略题号时从列表选择。 |
| `/delete [题号或 ID]` | 删除所选会话、容器和工作目录。 |
| `/queue` | 查看队列、题目状态和待确认答案。 |
| `/start` | 启动题目调度。 |
| `/priority [数值]` | 调整当前题的队列优先级，范围为 −1000 到 1000。 |
| `/switch [题号]` | 在轮次边界保存当前进度并切换推理题目。 |
| `/pause`、`/resume [题号]` | 暂停当前题或选择要恢复的题目。 |
| `/model [编号或 ID] [cpu 或 gpu]` | 选择模型。视觉型号可指定 projector 的运行设备。 |
| `/env [环境名]` | 选择新题的运行环境。 |
| `/effort` | 先选「正常推理」或「Compact 压缩」，再选关闭或思考强度。启用思考后可设置 token 预算。 |
| `/context [窗口 软压缩线]` | 设置会话窗口和自动压缩线，例如 `/context 64K 48K`。 |
| `/compact` | 请求在完整轮次结束后压缩上下文。 |
| `/checkpoint` | 请求在轮次边界保存当前驻留题的进度。 |
| `/offloadKV` | 暂停并尝试把驻留题的 KV 快照保存到内存。`/offloadKV config` 查看或设置内存余量和快照总上限。 |
| `/tab [面板]` | 切换面板，例如 `/tab budget` 查看窗口、用量和两套思考设置。 |
| `/tool [序号]`、`/read [路径]` | 展开一次工具输出，或读取当前题的文件。 |
| `/cancel [命令 ID]` | 取消当前题的一个后台命令。 |
| `/archive [消息 ID]` | 归档当前题的一条补充消息。 |
| `/review`、`/feedback [候选 ID] [结果] [说明]` | 选择待确认答案，或给当前题的候选记录 `correct`、`incorrect`、`pending`。 |
| `/skills [检索词]`、`/use-skill 名称` | 浏览或搜索已安装技能，或将指定技能的读取请求加入当前题。 |
| `/discard` | 清空当前输入草稿。 |
| `/help`、`/quit` | 查看快捷键和帮助，或保存并退出终端。 |

`/effort high 2048` 设置正常推理，`/effort compact low 1024` 开启 Compact 思考，`/effort compact off` 关闭它。两套设置分别保存在当前会话中。正在生成时，修改在轮次边界生效。

新建向导中，`/back` 返回上一步，`/browse [路径]` 在附件步骤打开选择器，`/cancel` 退出向导，`/view [题号]` 可暂时查看已有会话。
