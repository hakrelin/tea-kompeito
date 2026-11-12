# 茶与金平糖汉化组 · 官网与作品库

汉化组站点：作品目录、人员、公告、推荐、关于五个公开页面，加一个可登录的后台内容管理。
整套东西只有一个 Node 进程，没有前端框架、没有构建步骤，页面数据由 `content-default.js` 驱动。

- 公开站：`/`、`/staff.html`、`/news.html`、`/picks.html`、`/about.html`、`/account.html`
- 后台：`/admin/`（登录后可见，按栏目可视化编辑）
- 数据：`data/content.js`（原子写入，自动留一份 `content-backup.js`），首次运行回落到仓库里的种子 `content-default.js`

## 功能

**作品库**：126 条记录，含封面、图源（source）、翻译 / 嵌字 / 修图 / 校对署名、类型、状态、简介、关键词；
支持关键词搜索（`?q=`）、深链（`?work=<id>`）与分页。封面图在 `site/assets/catalog-covers/`。

**可见性分级**：作品 `access` 为 `public` / `member` / `restricted`，
账号角色 `member` / `reader` / `admin` 依次可见更多内容；受限作品的封面与补丁走私有上传，
只通过带鉴权的 `/api/files/<id>` 下发，不会出现在静态目录里。

**账号**：注册、登录、登出、会话（24 小时）；口令用 scrypt（N=32768, r=8, p=3）加盐散列；
登录与注册都有节流；Cookie 为 `HttpOnly; SameSite=Lax`，生产模式加 `Secure` 与 `__Host-` 前缀。

**后台**：五个栏目编辑 + 站点设置；封面上传到 `site/assets/uploads/`，
受限封面/下载文件上传后存到 `data/files/`；保存带 hash 版本号做乐观锁，
别人先保存会提示你先导出草稿再刷新核对。

**实时更新**：`/api/updates` 是 SSE 通道，后台保存后前台自动拉新内容，不用刷新。

## 目录

```
server.mjs            HTTP 服务：路由、鉴权、静态资源、上传、SSE
server/accounts.mjs   账号与会话（node:sqlite）
server/content.mjs    内容校验、可见性过滤、原子写入与版本号
server/errors.mjs     HttpError
content-default.js    内容种子（window.TEA_CONTENT = {...}）
site/index.html       五个页面共用的 HTML 壳（前端按 path 渲染）
site/assets/css/      site.css（站点）、account.css（登录/注册）
site/assets/js/       site.js、public-views.js、content-view.js、account.js
site/assets/img/      刊头、横幅、纸张、纸人、角花等切图
site/assets/fonts/    小赖字体（OFL，见 OFL-Xiaolai.txt）
site/assets/catalog-covers/  作品封面
admin/                后台单页（index.html + admin.css + admin.js）
work/build_assets.py  从设计稿切站点素材的脚本
notes/ personal/ preview/ other/  早期静态站与运维配置（历史留存）
*.conf *.sh build-nginx.sh        早期 Nginx 站点与服务器初始化脚本（历史留存）
wb*.ps1 check-site.sh deploy-site.sh revert-site.sh  早期本机运维脚本（历史留存）
```

## 本地运行

需要 **Node ≥ 22.5**（用到 `node:sqlite` 的 `DatabaseSync`）。

```bash
node server.mjs --port 8778 --data-dir data
# 打开 http://127.0.0.1:8778/
```

首次使用两个入口任选：

```bash
# 1) 命令行建管理员（交互输入两次密码）
node server.mjs --create-admin <用户名> --data-dir data

# 2) 浏览器里建：首次访问 /account.html 会出现"初始化管理员"
```

生产模式（强制 HTTPS、校验 Host、`__Host-` Cookie）：

```bash
node server.mjs --origin https://example.com --port 8778 --data-dir /var/lib/tea-site
```

`--data-dir` 必须放在站点目录之外，服务启动时会校验；目录权限 0700，内容文件 0600。

## 内容数据结构

`window.TEA_CONTENT` 由 `server/content.mjs` 校验，字段如下（都会 `trim()`，单字段上限 30000 字）：

| 段 | 字段 |
| --- | --- |
| `settings` | `title` `worksTitle` `staffTitle` `newsTitle` `picksTitle` `aboutTitle` `brand` `banner` `worksNote` `newsNote` `picksNote` `aboutNote` `staffSlots` |
| `works[]` | `id`(必填) `name`(必填) `orig` `type` `status` `source` `tl` `et` `tw` `pr` `cover` `thumb` `link` `linkHref` `desc` `keywords` `access` |
| `staff[]` | `name`(必填) `role`(必填) `bio` |
| `news[]` | `title`(必填) `date`(必填, `YYYY-MM-DD`) `body` `href` `keywords` |
| `picks[]` | `title`(必填) `source` `body` `cover` `href` `keywords` |
| `about` | `contactTitle` `contactNote` `seal` `sections[]`(`id` `title` `body` `keywords`) `contacts[]`(`name` `value` `href`) |

链接只接受站内路径（不含 `..`）、`http(s)://`、或联系方式里的 `mailto:`；
`cover`/`banner`/`brand` 还要求是可用的图片地址。

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/session` | 当前账号与是否处于首次初始化 |
| GET | `/api/content` | 按可见性过滤后的内容（带 ETag / 304） |
| GET | `/api/updates` | 内容变更 SSE 流 |
| POST | `/api/setup` `/api/register` `/api/login` `/api/logout` | 初始化 / 注册 / 登录 / 登出 |
| GET | `/api/files/<id>` | 受限封面与下载文件（需登录且被作品引用） |
| GET/PUT | `/admin/api/content` | 读取 / 保存全部内容（PUT 带 `revision`） |
| POST | `/admin/api/validate` | 只校验不落盘 |
| GET/PUT/POST | `/admin/api/accounts` | 账号列表 / 改权限 / 新建 |
| POST | `/admin/api/upload` | 公开封面上传 |
| POST | `/admin/api/private-upload` | 受限封面 / 补丁上传 |

## 素材

站点图标素都是设计稿切出来的：`work/mock-works.webp`（作品页）、`work/mock-staff.webp`（人员页）。

```bash
python work/build_assets.py work/mock-works.webp
```

会重新生成 `site/assets/img/` 下的 hero、刊头、纸张、阶梯、角花等。
正式美术稿到位后直接替换同名文件即可，比例保持一致（细节见脚本注释）。

## 封面体积与带宽

作品封面是页面最大的流量来源，所以做了三层处理：

1. **两级图**：封面原图压到宽 ≤ 480px（`q=74`，约 33KB），另生成一张网格用的缩略图
   `<id>-t.webp`（宽 240px，`q=62`，约 12KB）。网格只加载缩略图，选中作品时详情栏才取原图。
   命令行重新生成：

   ```bash
   python work/optimize-covers.py          # 幂等，已处理过的会跳过
   ```

   同一批 115 张封面的体积：原 6.85MB → 原图 3.83MB + 缩略图 1.31MB；
   首屏 16 张从约 1MB 降到约 190KB。

2. **缓存**：`/assets/img/`、`/assets/catalog-covers/` 由 nginx 直接从磁盘出并带
   `Cache-Control: max-age=2592000`，二次访问基本不产生流量；`/assets/js|css|fonts` 走 `?v=` 版本号 + 1 小时缓存。

3. **对象存储 + CDN（已启用）**：封面和站点切图都在七牛云，主服务器不再出图片流量。

   | 项目 | 值 |
   | --- | --- |
   | 存储空间 | `tea-kompeito`（华东 z0，公开空间） |
   | 加速域名 | `img.tea-kompeito.com`（HTTPS，泛域名证书 `*.tea-kompeito.com`） |
   | CNAME | `img-tea-kompeito-com-idvsa0z.qiniudns.com`（阿里云 DNS） |
   | 对象路径 | `covers/<id>.webp`、`covers/<id>-t.webp`、`site/<切图>` |
   | 缓存 | CDN 7 天（按后缀可调），响应头 `Cache-Control: max-age=31536000` |

   相关脚本（AK/SK 走环境变量 `QINIU_AK` / `QINIU_SK`，不要写进仓库）：

   ```bash
   # 1) 传封面（230 个文件，8 秒左右）
   QINIU_AK=... QINIU_SK=... python work/qiniu-upload.py upload
   # 2) 把内容里的 assets/... 改写成 CDN 地址（备份 .bak）
   python work/qiniu-migrate.py rewrite
   # 3) 线上数据用 live 模式改写
   python3 work/qiniu-migrate.py live /var/lib/tea-site-beta1/content.js
   # 4) 换新证书后重新绑定 CDN 域名（服务器上执行）
   python3 work/qiniu-https-server.py /etc/nginx/ssl/tea-kompeito.com/fullchain.crt /etc/nginx/ssl/tea-kompeito.com/private.key
   ```

   绑定/接入用 `work/qiniu-domain-flow.py`（取 TXT 校验值 → 校验所有权 → 创建加速域名 → 打印 CNAME），
   走的是 `api.qiniu.com` 的 Qiniu 鉴权和 `*/verify/*` 的 QBox 鉴权两套签名。

4. **后台上传直接进对象存储**：`/admin/api/upload` 现在先把图片传到七牛 `uploads/`，
   返回 `https://img.tea-kompeito.com/uploads/<sha>.webp`；没配 `QINIU_AK/SK` 时自动回落到本地
   `site/assets/uploads/`。这类封面没有 `-t.webp` 文件，`content.mjs` 会用七牛的图片处理
   （`?imageView2/1/w/240`）当网格缩略图，所以后台新传的封面同样不会拖慢列表。

   密钥放在 `/etc/tea-site/qiniu.env`（`600 root`），systemd 用
   `EnvironmentFile=` 注入给服务，仓库里只读环境变量。

## 证书自动续期

续期本身由服务器上的 cron 负责，每天 04:23 跑 `/opt/acme-kompeito/renew.sh`：
ACME DNS-01（阿里云解析）签 `tea-kompeito.com` + `*.tea-kompeito.com`，剩 30 天内才真正重签，
换证后备份旧证书、`nginx -t` 通过才 reload，失败自动回滚。

CDN 那边由钩子跟上，同一个脚本里多了一步：

```
nginx 部署新证书 → python3 /usr/local/bin/qiniu-cdn-cert.py
                   ├─ GET /domain/<域名> 读当前 https.certId
                   ├─ GET /sslcert/<id> 比对 PEM，一致就退出（可反复调用）
                   ├─ 私钥转 PKCS#8 → POST /sslcert 拿新 certID
                   ├─ PUT /domain/<域名>/httpsconf 换绑（forceHttps 关、http2 开）
                   └─ 清理 24 小时前的旧证书（太早删会报「证书已绑定域名」）
```

- 脚本：`work/qiniu-cdn-cert.py`，装到 `/usr/local/bin/`；`--force` 可跳过比对强制换绑
- 日志：与续期共用 `/var/log/acme-kompeito.log`
- 失败只会打 `[warn]`，不会影响 nginx 已生效的新证书；手动补跑：
  `python3 /usr/local/bin/qiniu-cdn-cert.py --force`
- 安装脚本：`work/install-qiniu-integration.sh`（写 env 文件、装钩子、加 systemd override，幂等）

## 部署

线上是「Node 进程 + Nginx 反代」，进程只监听 `127.0.0.1`，由 systemd 拉起：

```
/opt/<app>/releases/<timestamp>/    每次发布一个目录
/opt/<app>/current -> releases/...  软链切换，失败自动回滚
systemd 服务：node server.mjs --origin https://<域名> --port 8781 --data-dir /var/lib/<app>
Nginx：443 反代到 127.0.0.1:8781，静态资源可直接放行 /assets/
```

仓库里的 `tea-accounts.nginx.inc`、`tea-kompeito.com.conf`、`00-default.conf` 是给这套前端配置的参考片段，
域名、证书路径、上游端口按实际替换；早期 `setup.sh` / `build-nginx.sh` 是当时那台机器的初始化脚本，仅作参考。

后台首次上线后立刻在 `/account.html` 建管理员，再把注册开关按需关闭（`/admin/api/accounts` 控制角色）。

## 许可

- 站点代码：随仓库提供，供本站与同好参考。
- 字体：小赖字体（Xiaolai），SIL Open Font License 1.1，见 `site/assets/fonts/OFL-Xiaolai.txt`。
- 作品封面与站点插画：版权归原作者与汉化组，不随代码授权，请勿另行分发。
