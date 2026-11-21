<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/public/images/logo-on-dark.svg" />
  <img src="web/public/logo.svg" alt="梦想画布 Logo" width="120" height="120" />
</picture>

# 梦想画布 · Dream Canvas

**想象不设边界 · 创作，自由展开**

面向影视、短剧与 AI 视频创作的自托管无限画布

<p>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" />
  <img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Vite 7" src="https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white" />
  <img alt="Go 1.25" src="https://img.shields.io/badge/Go-1.25-00ADD8?style=flat-square&logo=go&logoColor=white" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" />
  <img alt="MIT License" src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" />
</p>

<p>
  <a href="#核心功能">核心功能</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#docker-部署推荐">Docker 部署</a> ·
  <a href="#部署说明">部署说明</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/public/images/landing/canvas-zh-dark.webp" />
  <source media="(prefers-color-scheme: light)" srcset="web/public/images/landing/canvas-zh-light.webp" />
  <img src="web/public/images/landing/canvas-zh-light.webp" alt="梦想画布实际界面：在同一画布中组织剧本、人物参考与分镜画面" width="1200" />
</picture>

<sub>实际界面截图，使用《归途》演示剧本与公开参考素材。<a href="web/public/images/landing/README.md">截图与素材说明</a></sub>

</div>

梦想画布把剧本、人物设定、场景参考、分镜与生成结果放在同一张无限画布上。通过节点和连线整理故事，也可以进入独立的生图工作台、视频创作台，或让助手协助操作项目。

项目面向个人与小团队自托管：前端负责交互，Go 服务统一管理账号、项目、私有资产、模型渠道、生成任务和助手执行，数据保存在自己的服务器上。界面支持中文、英文与黑白中性浅深主题。

> 项目仍在持续开发与验收。文本、图片模型接入已通过用户实际测试；视频、TTS、助手工具调用、安全、任务恢复及性能等专项仍需独立验收。代码实施与实际验收进度见 [CHANGELOG → Unreleased](CHANGELOG.md#unreleased)。

## 核心功能

| 功能 | 说明 |
| --- | --- |
| 无限画布 | 用文本、图片、视频、音频、生成配置和组节点组织创作；支持节点连线、自动保存、撤销 / 重做及项目导入导出。内置便利贴、3D 全景和超分节点。 |
| 生图与视频工作台 | 提示词、参考素材、模型参数和生成记录集中编辑；图片保持原始比例展示，成品可下载或手动加入资产库。支持的创作模式与参数由所选模型的接口插件决定。 |
| 私有资产库 | 统一管理文本、图片、视频和音频，跨项目复用素材；媒体原件保存在服务端，可后台同步至私有对象存储，分别显示保存与同步状态。 |
| 灵感库 | 在同一个入口管理文本、图片、视频提示词与技能；包含项目内置内容及账号个人内容，支持搜索、筛选与在创作中选用。 |
| 助手与 MCP | 全局助手通过业务工具整理项目、编辑节点、查找素材及提交生成任务；外部客户端通过 Streamable HTTP MCP 访问同一业务能力，按令牌限制项目和操作范围。 |
| 渠道与接口插件 | 按「渠道 → 模型」配置和选择模型；内置 OpenAI 兼容文本、图片、TTS、视频接口及 Seedance、MiniMax 视频适配，自建 JavaScript 接口插件可配置输入、保存草稿与发布版本。 |
| 任务与用量 | 在「设置 → 任务与用量」查看任务阶段、结果与待处理状态，以及按时间、项目、渠道、模型和类型筛选的调用次数；任务切页后继续在服务端处理。 |
| 账号与站点管理 | 管理员创建和停用账号，配置站点开关、并发、渠道、对象存储、节点启停与日志；项目、资产和助手历史默认按用户隔离。 |

接口插件在服务端执行，画布节点插件在浏览器执行，两者的运行边界不同。节点扩展约定见 [节点插件说明](plugins/canvas/README.md)。

## 快速开始

只需要部署使用时，可直接跳到 [Docker 部署](#docker-部署推荐)，宿主机无需安装 Go、Node.js 或 ffmpeg。以下为支持前端热更新的本地开发方式。

### 环境准备

- **Go 1.25+**。
- **Node.js 22.12+ 与 npm**，前端依赖统一使用 npm 安装。
- **ffmpeg、ffprobe**：安装在后端运行环境的 `PATH` 中，用于视频封面和音视频元数据探测。缺失时原件保留，但相关预览或素材校验可能无法完成。
- 支持 **Web Locks** 的现代浏览器，通过 `localhost` 或 HTTPS 访问。

### 启动后端

```bash
git clone https://github.com/qgming/dream-canvas.git
cd dream-canvas/server
go mod download

# 仅首次初始化时执行，按提示在终端输入管理员密码
go run ./cmd/server -init-admin admin

# 启动业务服务
go run ./cmd/server
```

初始化命令仅允许在没有账号的数据库中执行，不提供默认密码。后端默认监听 `127.0.0.1:8080`，数据保存在当前工作目录下的 `data/`；按上述方式启动时即为 `server/data/`。

### 启动前端

另开终端，在仓库根目录执行：

```bash
cd web
npm ci
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。开发前端使用 Vite，支持热更新，并将 `/api`、`/mcp` 同源转发到后端。

### 首次配置

1. 点击首页右上角「登录」，使用初始化的管理员账号进入应用；其他账号由管理员在「设置 → 账号管理」创建。
2. 在「设置 → 渠道与模型」添加渠道，填写名称、完整 API URL 和 KEY，再添加模型并选择能力类型与接口插件。**URL 不会自动补 `/v1`**，请按服务实际地址填写。
3. 调整模型参数与各创作入口的排序，然后进入画布或工作台。助手需要支持工具调用的文本模型；非标准接口可在「设置 → 接口插件」编写或导入 ZIP 整包，发布后绑定模型。真实测试会调用供应商，费用由配置的服务决定。
4. 如果模型要求公网 HTTPS 素材，在「设置 → 对象存储」配置私有存储。支持阿里云 OSS、Cloudflare R2、腾讯云 COS、七牛云 S3 与通用 S3 模板；素材同步后按任务提供受限访问地址，无需公开 Bucket。

站点默认开放。管理员可在「设置 → 站点管理」暂停普通用户访问；已提交的生成任务继续处理和保存，管理员仍可登录重新开启。

需要连接外部工具时，在「设置 → 访问令牌」生成远程 MCP 配置，服务端入口为 `/mcp`。项目、素材和任务操作不依赖在线浏览器；选区、视口等页面操作需要绑定在线页面。

## 部署说明

### Docker 部署（推荐）

需要 Docker Engine 或 Docker Desktop（Linux 容器模式），以及 **Docker Compose v2.24.4+**（HTTPS 组合配置使用 `!override` 替换端口映射）。默认从 GHCR 拉取预构建镜像，部署服务器无需编译。对应镜像须先由仓库工作流成功发布，并将 GHCR 包设为 **Public**；若尚无可拉取的版本，使用下方「本地源码构建」。

```bash
git clone https://github.com/qgming/dream-canvas.git
cd dream-canvas
cp .env.example .env
# 建议在 .env 中将 DREAM_CANVAS_TAG 改为已发布的 vX.Y.Z
docker compose pull

# 仅首次执行；在交互终端输入管理员密码，不要使用 -T 或管道输入
docker compose run --rm --no-deps --pull never dream-canvas -data /data -init-admin admin

docker compose up -d --no-build --pull never
docker compose ps
```

PowerShell 将复制命令替换为 `Copy-Item .env.example .env`。已有 `.env` 时保留原配置；初始化仅允许空账号数据库，不会提供默认密码。打开 [http://localhost:8080](http://localhost:8080)，后续账号、渠道与模型配置见上方「首次配置」。

镜像通过多阶段构建打包前端和 Go 服务，包含固定 **FFmpeg / ffprobe 9.1**、HTTPS 根证书与时区数据。FFmpeg 使用[官方稳定版源码](https://ffmpeg.org/download.html)和固定 SHA-256 构建，保留对应源码、LGPL 许可证、编译参数与构建文件于 `/app/licenses/ffmpeg`，不启用 GPL / nonfree 组件；用于本地元数据探测和视频封面，不改动媒体原件。后续安全更新需显式调整版本与校验值并重新构建镜像。

运行时使用 **UID/GID `10001:10001` 的非 root 用户**，由 Go 同源提供网页、`/api` 与 `/mcp`，无需另起 Node.js 服务或数据库容器。前端构建会一并包含内置节点源码、插件 SDK 与根目录 `VERSION`；QuickJS WASM 随 Go 二进制嵌入。

| 文件 / 配置 | 作用 |
| --- | --- |
| [`Dockerfile`](Dockerfile) | npm / Go 分阶段构建、非 root 运行、媒体工具与 `/api/health` 健康探测；镜像作者署名 qgming，原项目和第三方许可随镜像保留。 |
| [`.dockerignore`](.dockerignore) | 仅纳入必要源码，排除本机数据、环境文件、密钥、日志、依赖与旧构建产物。 |
| [`compose.yaml`](compose.yaml) | 单服务 HTTP 部署、持久数据卷与容器退出后自动重启；默认仅绑定宿主机 `127.0.0.1:8080`。 |
| [`compose.build.yaml`](compose.build.yaml) | 显式启用本地源码构建，与生产镜像拉取分开。 |
| [`compose.https.yaml`](compose.https.yaml) / [`deploy/Caddyfile`](deploy/Caddyfile) | 可选 Caddy HTTPS 入口、自动证书与流式代理。 |
| [`.github/workflows/docker.yml`](.github/workflows/docker.yml) | 原生 amd64 / arm64 构建、媒体与启动检查、GHCR 发布及匿名拉取验证；不登录或部署用户服务器。 |
| [`.env.example`](.env.example) | 镜像标签、项目名、HTTP 绑定地址 / 端口、可信代理、时区及 HTTPS 域名示例；不配置管理员密码或供应商 KEY。 |

镜像地址为 `ghcr.io/qgming/dream-canvas`，支持 `linux/amd64` 和 `linux/arm64`，Docker 自动选择宿主机架构。标签规则如下：

| `DREAM_CANVAS_TAG` | 来源 |
| --- | --- |
| `vX.Y.Z` | 与根目录 `VERSION` 完全一致的正式 Git tag；推荐生产部署固定已发布版本，保留 `v` 前缀。 |
| `latest`（默认） | 正式版本发布时更新；`main` 提交不会覆盖它。 |
| `main` | `main` 分支的开发镜像。 |
| `sha-<完整提交 SHA>` | 成功发布的具体提交镜像，便于定位构建。 |

首次发布者需在 GitHub 包设置中确认公开可见性；仓库公开不代表 GHCR 包自动公开，工作流会在独立、未登录的环境实际拉取镜像，失败则明确报错。镜像大小和升级耗时以工作流输出及服务器实测为准，不承诺 250 MB 或一分钟内完成。

`.env` 中的 `DREAM_CANVAS_PORT` 可修改宿主机 HTTP 端口，`DREAM_CANVAS_BIND` 默认仅允许本机访问；远程使用请配置下方 HTTPS。`TZ` 默认 `UTC`，可设为 `Asia/Shanghai`。`COMPOSE_PROJECT_NAME` 决定数据卷归属，首次部署后保持不变；多实例应分别设置项目名和端口，且不共享数据卷。

**持久数据**全部写入 `/data`，默认由名为 `dream-canvas_data` 的 Docker 数据卷保存，包含数据库、`credentials.key`、原件、待处理响应和应用日志。重建镜像、重建容器及 `docker compose down` 不删除该卷；**不要执行 `docker compose down -v` 或删除数据卷**。不要将同一 SQLite 数据卷同时挂给多个运行中的应用实例，也不要把整个源码目录挂载到 `/app` 遮住静态产物。

#### 本地源码构建

需要修改源码或尚未发布预构建镜像时，显式使用构建覆盖文件；它使用 `dream-canvas:local`，不读取 `DREAM_CANVAS_TAG`，也不拉取同名镜像：

```bash
docker compose -f compose.yaml -f compose.build.yaml build --pull
# 仅空账号数据库需要初始化
docker compose -f compose.yaml -f compose.build.yaml run --rm --no-deps dream-canvas -data /data -init-admin admin
docker compose -f compose.yaml -f compose.build.yaml up -d --no-build
```

后续管理和备份同样使用这两个 `-f` 参数。搭配 HTTPS 时，在它们之后追加 `-f compose.https.yaml`，首次启动前先拉取 Caddy：`docker compose -f compose.yaml -f compose.build.yaml -f compose.https.yaml pull caddy`。源码构建在当前机器完成，低配置服务器优先使用已发布镜像。

#### HTTPS 与域名

将实际域名解析到服务器，在 `.env` 填写 `DOMAIN=canvas.example.com`（不带协议和路径），并确保宿主机 TCP 80 / 443 可达且未被占用；配置同时发布 UDP 443 供 HTTP/3 使用。然后执行：

```bash
# 从 HTTP 模式切换时先停止原容器，数据卷保留
docker compose down
docker compose -f compose.yaml -f compose.https.yaml pull
docker compose -f compose.yaml -f compose.https.yaml up -d --no-build --pull never
docker compose -f compose.yaml -f compose.https.yaml logs -f caddy
```

通过 `https://你的域名` 访问。Caddy 自动申请与续期证书，证书和状态保存在独立的 `caddy_data` / `caddy_config` 数据卷。后续 `up`、`down`、`stop`、日志及升级操作均使用相同的两个 `-f` 参数。

HTTPS 模式让 Caddy 与应用共享网络命名空间，应用仅监听容器内 `127.0.0.1:8080`，同时移除宿主机 HTTP 端口映射。默认仍只信任回环代理，由 Caddy 保留原始 `Host`、覆盖 `X-Forwarded-Proto`，并即时转发 SSE / MCP 响应，无需额外可信代理配置。

如果使用**宿主机上的 Caddy / Nginx + Docker 端口映射**，应用看到的对端通常是 Docker 桥接网关。先通过 `docker inspect "$(docker compose ps -q dream-canvas)" --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{println}}{{end}}'` 核对实际网关；若有多个网络，确认代理实际使用的那个来源。在 `.env` 设置 `DREAM_CANVAS_TRUSTED_PROXIES=实际网关IP/32`（IPv6 用 `/128`，多个来源逗号分隔），再执行 `docker compose up -d --force-recreate`。原生启动可使用 `-trusted-proxies`，会覆盖同名环境变量。不要照抄示例 IP、信任整个 Docker 网段或设置 `0.0.0.0/0`；保持 HTTP 端口仅绑定 `127.0.0.1`，可信代理必须覆盖客户端传来的转发头，并保留原始 `Host`。

仅当请求直接使用 TLS，或实际连接对端属于可信来源且 `X-Forwarded-Proto` 恰为 `https` 时，会话 Cookie 才带 `Secure`；缺失、`http` 或不可信来源均不会因转发头获得 `Secure`。未配置宿主机网关时，宿主机反代登录的 Cookie 不会自动带 `Secure`。网关地址变化后需同步更新配置。

#### 日常管理与升级

以下为基础 HTTP 模式命令；HTTPS 模式在 `docker compose` 后追加 `-f compose.yaml -f compose.https.yaml`。

```bash
docker compose logs -f --tail=100 dream-canvas
docker compose ps
docker compose stop
docker compose up -d --no-build --pull never
```

健康探测只检查 `/api/health` 是否响应，不表示供应商、对象存储或全部任务链路通过验收，也不会单凭 `unhealthy` 状态自动重启。应用自己的文件日志开关与 Docker 收集的终端输出分别管理，后者沿用宿主机 Docker 日志配置。

升级前记录当前镜像摘要，并按下方方式**在修改镜像标签前**完整备份数据；然后将 `.env` 中的 `DREAM_CANVAS_TAG` 改为目标已发布版本，拉取并替换容器：

```bash
docker inspect "$(docker compose ps -q dream-canvas)" --format '{{.Config.Image}} {{.Image}}'
# 记录上述结果，完成数据备份后再修改 .env
docker compose pull
docker compose up -d --no-build --pull never --force-recreate
docker compose ps
```

HTTPS 模式的 `--force-recreate` 会一并重建共享网络的 Caddy。保留 `.env` 和原数据卷，升级前后查看 `ps` 与日志；不要重新执行管理员初始化。源码构建方式则在备份后更新源码、重新执行 `build --pull`，再带相同的覆盖文件重建容器。

应用启动会自动调整数据库结构。仅当目标旧版确认兼容当前数据时，才可将 `DREAM_CANVAS_TAG` 改回旧版并重新拉取、启动；需要恢复数据时，应将升级前的完整备份恢复到新空卷，再用与备份匹配的旧镜像启动。**回退镜像不等于回退数据库**，数据库与 `credentials.key` 必须成套保存和恢复。此配置不设置内存 / CPU 硬限制，不把未实测的 1 核 / 1 GiB 目标写成运行保证。

#### Docker 数据备份与恢复

在仓库根目录执行，先停止应用，避免 SQLite 与原件在备份期间变化。下面将完整 `/data` 打包到宿主机 `backups/`；为每次备份选择不重复的文件名。

```bash
mkdir -p backups
docker compose stop
docker compose run --rm --no-deps --pull never --user 0:0 --entrypoint tar --volume "${PWD}/backups:/backup" dream-canvas -czpf /backup/dream-canvas-data.tar.gz -C /data .
docker compose up -d --no-build --pull never
```

PowerShell 将建目录命令替换为 `New-Item -ItemType Directory -Force backups`。备份命令仅临时以 root 运行 `tar` 读取数据，正常应用继续使用非 root 用户；保留文件属主和权限，并妥善保护包含解密密钥与私有媒体的归档。HTTPS 模式的备份 / 恢复命令同样追加两个 `-f` 参数，Caddy 证书卷独立于应用数据备份。

恢复时使用**全新、空的数据卷**，并保持所有应用实例停止；将备份放入当前目录的 `backups/`，再执行：

```bash
docker compose stop
docker compose run --rm --no-deps --pull never --user 0:0 --entrypoint tar --volume "${PWD}/backups:/backup:ro" dream-canvas -xzpf /backup/dream-canvas-data.tar.gz -C /data
docker compose up -d --no-build --pull never
```

如果目标已有数据，先单独备份，并选择新的 Compose 项目名创建独立数据卷后再恢复，不向运行中或已有内容的卷直接覆盖解压。不自动导入本机 `server/data/`；确需转移时，先停原服务，按完整数据目录备份 / 恢复，并确保恢复后的文件归容器 UID/GID `10001:10001` 所有。自定义宿主机目录挂载也必须提前准备可由该用户读写的目录，遇到权限问题不要长期改用 root 运行服务。

Docker 部署使用前端静态产物，改动源码后需要重建镜像；日常前端开发继续使用上方 `npm run dev` 的 Vite 热更新流程。

### 源码部署

以 Linux 为例，在仓库根目录构建前端与后端：

```bash
cd web
npm ci
npm run build

cd ../server
go build -o dream-canvas-server ./cmd/server
```

继续在 `server/` 目录执行。全新部署先初始化管理员，已有账号时跳过第一条命令：

```bash
./dream-canvas-server -data ./data -init-admin admin
./dream-canvas-server -data ./data -web ../web/dist -listen 127.0.0.1:8080
```

Go 服务可直接提供 `web/dist` 中的静态页面，无需单独运行 Node.js 前端服务。运行目录变化时，显式指定数据与静态目录路径；升级时使用同一份持久数据目录，并同步更新前后端。

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `-data` | `data` | 数据库、密钥、媒体及待处理文件的持久目录 |
| `-listen` | `127.0.0.1:8080` | HTTP 监听地址 |
| `-web` | `../web/dist` | 前端静态产物目录 |
| `-trusted-proxies` | `DREAM_CANVAS_TRUSTED_PROXIES`，未设置时仅信任回环来源 | 额外可信反代 IP/CIDR，逗号分隔；用于客户端 IP 和 HTTPS Cookie 判定 |
| `-init-admin` | 不启用 | 初始化管理员用户名，完成后退出 |

对外访问时通过反向代理提供 HTTPS，保留原始 `Host`，由本机代理正确设置 `X-Forwarded-Proto`，并关闭 SSE 响应缓冲。单独托管静态文件时，同源转发 `/api` 与 `/mcp`，并为前端路由提供 `index.html` 回退。

### 数据与备份

项目采用单进程 SQLite 部署，不依赖 PostgreSQL 或 Redis。**服务端是业务数据的权威来源**；浏览器仅保留界面偏好、缓存及工作台创作草稿，不能代替服务端备份。

- 将 `-data` 指向持久目录，不要放入前端静态目录或在升级时覆盖。
- 停止服务后备份整个数据目录，包含 SQLite 数据库、媒体原件、待处理响应和 **`credentials.key`**；密钥丢失会导致已有渠道、存储及任务快照中的凭据无法解密。
- 「设置 → 数据备份」只导出 / 导入**当前账号的资产库**，不包含整站数据库、账号或系统配置。对象存储同步同样不等于整站备份。
- 工作台生成记录中的成品需要主动「加入资产库」以保留；删除记录会清理未保留且未被其他记录或项目引用的专属文件，正在使用的素材会等待任务释放。

本项目不提供公开注册、支付、对外分享或实时协同。安全边界与反馈方式见 [SECURITY.md](SECURITY.md)，剩余实施及验收事项见 [CHANGELOG](CHANGELOG.md#unreleased)。

## 开源协议

梦想画布由 **qgming** 设计、开发与维护，项目原创及新增内容署名 qgming。

梦想画布项目部分理念和实现方式参考 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 和 [DEEIX-Chat](https://github.com/DEEIX-AI/DEEIX-Chat)两个开源项目

项目采用 [MIT License](LICENSE)，版权署名为 `Copyright (c) 2026 qgming`，同时保留上游原始版权声明。第三方组件遵循各自许可证：QuickJS WASM 绑定的来源与局部修改见 [第三方说明](server/third_party/qjs/NOTICE.md)；首页 Glyph 背景所附的 **MIT + Commons Clause** 条款见 [Animate UI 许可证](web/src/components/animate-ui/LICENSE.md)。
