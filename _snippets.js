// 更新日期: 2026-06-29
// 更新内容:
// 1. 从 Cloudflare Workers 移植到 Cloudflare Snippets (Rules → Snippets)
// 2. 替换 redirect: 'manual' 为 redirect: 'follow' + 手动检测
// 3. 重构 Docker S3 重定向处理逻辑（基于 response.redirected 检测）
// 4. 处理 request.body 复用问题（使用 request.clone()）
// 注意: 功能与 _worker.js 完全一致，仅适配 Snippets 运行时
// 注意: Snippets 运行时也使用 ESM 模块格式（export default），与 Workers 相同
// 用户配置区域开始 =================================
// 以下变量用于配置代理服务的白名单和安全设置，可根据需求修改。

// ALLOWED_HOSTS: 定义允许代理的域名列表（默认白名单）。
// - 添加新域名：将域名字符串加入数组，如 'docker.io'。
// - 注意：仅支持精确匹配的域名（如 'github.com'），不支持通配符。
// - 只有列出的域名会被处理，未列出的域名将返回 400 错误。
// 示例：const ALLOWED_HOSTS = ['github.com', 'docker.io'];
const ALLOWED_HOSTS = [
  'quay.io',
  'gcr.io',
  'k8s.gcr.io',
  'registry.k8s.io',
  'ghcr.io',
  'docker.cloudsmith.io',
  'registry-1.docker.io',
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'gist.github.com',
  'gist.githubusercontent.com',
  'gitlab.com',
  'gitlab.freedesktop.org',
  'gitlab.gnome.org',
  'gitlab.kitware.com',
  'gitlab.archlinux.org',
  'gitlab.postmarketos.org'
];

// RESTRICT_PATHS: 控制是否限制 GitHub 和 Docker 请求的路径。
// - 设置为 true：只允许 ALLOWED_PATHS 中定义的路径关键字。
// - 设置为 false：允许 ALLOWED_HOSTS 中的所有路径。
// 示例：const RESTRICT_PATHS = true;
const RESTRICT_PATHS = false;

// ALLOWED_PATHS: 定义 GitHub 和 Docker 的允许路径关键字。
// - 添加新关键字：加入数组，如 'user-id-3' 或 'my-repo'。
// - 用于匹配请求路径（如 'library' 用于 Docker Hub 官方镜像）。
// - 路径检查对大小写不敏感，仅当 RESTRICT_PATHS = true 时生效。
// 示例：const ALLOWED_PATHS = ['library', 'my-user', 'my-repo'];
const ALLOWED_PATHS = [
  'library',   // Docker Hub 官方镜像仓库的命名空间
  'user-id-1',
  'user-id-2',
];

// 用户配置区域结束 =================================

// 闪电 SVG 图标（Base64 编码）
const LIGHTNING_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
</svg>`;

// 首页 HTML
const HOMEPAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cloudflare 加速</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(LIGHTNING_SVG)}">
<script src="https://cdn.tailwindcss.com"></script>
<style>
body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif;transition:background-color .3s,color .3s;padding:1rem}
.light-mode{background:linear-gradient(to bottom right,#f1f5f9,#e2e8f0);color:#111827}
.dark-mode{background:linear-gradient(to bottom right,#1f2937,#374151);color:#e5e7eb}
.container{width:100%;max-width:800px;padding:1.5rem;border-radius:.75rem;border:1px solid #e5e7eb;box-shadow:0 8px 16px rgba(0,0,0,.1)}
.light-mode .container{background:#fff}
.dark-mode .container{background:#1f2937}
.section-box{background:linear-gradient(to bottom,#fff,#f3f4f6);border-radius:.5rem;padding:1.5rem;margin-bottom:1.5rem;box-shadow:0 4px 8px rgba(0,0,0,.1)}
.dark-mode .section-box{background:linear-gradient(to bottom,#374151,#1f2937);box-shadow:0 4px 8px rgba(0,0,0,.2)}
.theme-toggle{position:fixed;top:.5rem;right:.5rem;padding:.5rem;font-size:1.2rem}
.toast{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:.75rem 1.5rem;border-radius:.5rem;box-shadow:0 4px 6px rgba(0,0,0,.1);opacity:0;transition:opacity .3s;font-size:.9rem;max-width:90%;text-align:center}
.toast.show{opacity:1}
.result-text{word-break:break-all;overflow-wrap:break-word;font-size:.95rem;max-width:100%;padding:.5rem;border-radius:.25rem;background:#f3f4f6}
.dark-mode .result-text{background:#2d3748}
input[type="text"]{background-color:#fff!important;color:#111827!important}
.dark-mode input[type="text"]{background-color:#374151!important;color:#e5e7eb!important}
@media(max-width:640px){.container{padding:1rem}.section-box{padding:1rem;margin-bottom:1rem}h1{font-size:1.5rem;margin-bottom:1.5rem}h2{font-size:1.25rem;margin-bottom:.75rem}p{font-size:.875rem}input{font-size:.875rem;padding:.5rem;min-height:44px}button{font-size:.875rem;padding:.5rem 1rem;min-height:44px}.flex.gap-2{flex-direction:column;gap:.5rem}.github-buttons,.docker-buttons{flex-direction:column;gap:.5rem}.result-text{font-size:.8rem;padding:.4rem}footer{font-size:.75rem}}
</style>
</head>
<body class="light-mode">
<button onclick="toggleTheme()" class="theme-toggle bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition"><span class="sun">☀️</span><span class="moon hidden">🌙</span></button>
<div class="container mx-auto">
<h1 class="text-3xl font-bold text-center mb-8">Cloudflare 加速下载</h1>
<div class="section-box">
<h2 class="text-xl font-semibold mb-2">⚡ GitHub 文件加速 / Git Clone</h2>
<p class="text-gray-600 dark:text-gray-300 mb-4">输入 GitHub 文件链接获取加速链接；输入以 .git 结尾的仓库地址则自动生成 git clone 加速命令。</p>
<div class="flex gap-2 mb-2">
<input id="github-url" type="text" placeholder="请输入 GitHub 文件链接或 .git 仓库地址，例如：https://github.com/user/repo/releases/..." class="flex-grow p-2 border border-gray-400 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500">
<button id="github-submit-btn" onclick="convertGithubUrl()" class="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition">获取加速链接</button>
</div>
<p id="github-result" class="mt-2 text-green-600 dark:text-green-400 result-text hidden"></p>
<div id="github-buttons" class="flex gap-2 mt-2 github-buttons hidden">
<button onclick="copyGithubUrl()" class="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition w-full">📋 复制</button>
<button onclick="openGithubUrl()" class="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition w-full">🔗 打开链接</button>
</div>
</div>
<div class="section-box">
<h2 class="text-xl font-semibold mb-2">🐳 Docker 镜像加速</h2>
<p class="text-gray-600 dark:text-gray-300 mb-4">输入原镜像地址（如 hello-world 或 ghcr.io/user/repo），获取加速拉取命令。</p>
<div class="flex gap-2 mb-2">
<input id="docker-image" type="text" placeholder="请输入镜像地址，例如：hello-world 或 ghcr.io/user/repo" class="flex-grow p-2 border border-gray-400 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500">
<button onclick="convertDockerImage()" class="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition">获取加速命令</button>
</div>
<p id="docker-result" class="mt-2 text-green-600 dark:text-green-400 result-text hidden"></p>
<div id="docker-buttons" class="flex gap-2 mt-2 docker-buttons hidden">
<button onclick="copyDockerCommand()" class="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition w-full">📋 复制命令</button>
</div>
</div>
<footer class="mt-6 text-center text-gray-500 dark:text-gray-400">
Powered by <a href="https://github.com/fscarmen2/Cloudflare-Accel" class="text-blue-500 hover:underline">fscarmen2/Cloudflare-Accel</a>
</footer>
</div>
<div id="toast" class="toast"></div>
<script>
const currentDomain=window.location.hostname;
function toggleTheme(){const b=document.body,s=document.querySelector('.sun'),m=document.querySelector('.moon');if(b.classList.contains('light-mode')){b.classList.remove('light-mode');b.classList.add('dark-mode');s.classList.add('hidden');m.classList.remove('hidden');localStorage.setItem('theme','dark')}else{b.classList.remove('dark-mode');b.classList.add('light-mode');m.classList.add('hidden');s.classList.remove('hidden');localStorage.setItem('theme','light')}}
if(localStorage.getItem('theme')==='dark')toggleTheme();
function showToast(msg,err){const t=document.getElementById('toast');t.textContent=msg;t.classList.remove(err?'bg-green-500':'bg-red-500');t.classList.add(err?'bg-red-500':'bg-green-500');t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)}
function copyToClipboard(t){if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(t).catch(()=>false);const ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();try{const r=document.execCommand('copy');document.body.removeChild(ta);return r?Promise.resolve():Promise.reject(new Error('Copy failed'))}catch(e){document.body.removeChild(ta);return Promise.reject(e)}}
let githubAcceleratedUrl='',githubIsGitMode=false;
function convertGithubUrl(){const i=document.getElementById('github-url').value.trim(),r=document.getElementById('github-result'),b=document.getElementById('github-buttons'),s=document.getElementById('github-submit-btn'),c=b.children[0],o=b.children[1];if(!i){showToast('请输入有效的链接',true);r.classList.add('hidden');b.classList.add('hidden');return}if(!i.startsWith('https://')){showToast('链接必须以 https:// 开头',true);r.classList.add('hidden');b.classList.add('hidden');return}if(i.endsWith('.git')){githubIsGitMode=true;s.textContent='获取加速命令';const p=i.substring(8);githubAcceleratedUrl='git clone https://'+currentDomain+'/https://'+p;r.textContent='加速命令: '+githubAcceleratedUrl;r.classList.remove('hidden');b.classList.remove('hidden');c.textContent='📋 复制命令';if(o)o.classList.add('hidden');copyToClipboard(githubAcceleratedUrl).then(()=>showToast('已复制到剪贴板')).catch(e=>showToast('复制失败',true));return}githubIsGitMode=false;s.textContent='获取加速链接';githubAcceleratedUrl='https://'+currentDomain+'/https://'+i.substring(8);r.textContent='加速链接: '+githubAcceleratedUrl;r.classList.remove('hidden');b.classList.remove('hidden');c.textContent='📋 复制链接';if(o)o.classList.remove('hidden');copyToClipboard(githubAcceleratedUrl).then(()=>showToast('已复制到剪贴板')).catch(e=>showToast('复制失败',true))}
function copyGithubUrl(){copyToClipboard(githubAcceleratedUrl).then(()=>showToast('已复制到剪贴板')).catch(e=>showToast('复制失败',true))}
function openGithubUrl(){if(!githubIsGitMode)window.open(githubAcceleratedUrl,'_blank')}
let dockerCommand='';
function convertDockerImage(){const i=document.getElementById('docker-image').value.trim(),r=document.getElementById('docker-result'),b=document.getElementById('docker-buttons');if(!i){showToast('请输入有效的镜像地址',true);r.classList.add('hidden');b.classList.add('hidden');return}dockerCommand='docker pull '+currentDomain+'/'+i;r.textContent='加速命令: '+dockerCommand;r.classList.remove('hidden');b.classList.remove('hidden');copyToClipboard(dockerCommand).then(()=>showToast('已复制到剪贴板')).catch(e=>showToast('复制失败',true))}
function copyDockerCommand(){copyToClipboard(dockerCommand).then(()=>showToast('已复制到剪贴板')).catch(e=>showToast('复制失败',true))}
</script>
</body>
</html>`;

async function handleToken(realm, service, scope) {
  const tokenUrl = `${realm}?service=${service}&scope=${scope}`;
  console.log(`Fetching token from: ${tokenUrl}`);
  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!tokenResponse.ok) {
      console.log(`Token request failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
      return null;
    }
    const tokenData = await tokenResponse.json();
    const token = tokenData.token || tokenData.access_token;
    if (!token) {
      console.log('No token found in response');
      return null;
    }
    console.log('Token acquired successfully');
    return token;
  } catch (error) {
    console.log(`Error fetching token: ${error.message}`);
    return null;
  }
}

function isAmazonS3(url) {
  try {
    return new URL(url).hostname.includes('amazonaws.com');
  } catch {
    return false;
  }
}

// 计算请求体的 SHA256 哈希值
async function calculateSHA256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 获取空请求体的 SHA256 哈希值
function getEmptyBodySHA256() {
  return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
}

// 检测是否为 Git smart-http 协议请求
function isGitRequest(request, targetDomain) {
  // 检查 User-Agent 是否包含 git/
  const ua = request.headers.get('User-Agent') || '';
  if (ua.toLowerCase().includes('git/')) {
    return true;
  }
  // 检查目标域名是否为 Git 托管平台
  const gitDomains = ['github.com', 'api.github.com', 'raw.githubusercontent.com', 'gist.github.com', 'gist.githubusercontent.com', 'gitlab.com', 'gitlab.freedesktop.org', 'gitlab.gnome.org', 'gitlab.kitware.com', 'gitlab.archlinux.org', 'gitlab.postmarketos.org'];
  if (gitDomains.includes(targetDomain)) {
    // 检查路径是否包含 Git 协议特征
    const url = new URL(request.url);
    const path = url.pathname;
    // Git smart-http 使用 /info/refs?service=git-upload-pack 或 /git-upload-pack
    if (path.includes('/info/refs') || path.includes('/git-upload-pack') || path.includes('/git-receive-pack')) {
      return true;
    }
    // 路径包含 .git 也可能是 Git 请求（如 /user/repo.git/...）
    if (path.includes('.git')) {
      return true;
    }
  }
  return false;
}

// 为 Git 请求构建正确的代理请求头
function buildGitHeaders(request, targetDomain) {
  const headers = new Headers(request.headers);

  // 设置正确的 Host
  headers.set('Host', targetDomain);

  // 删除可能干扰 Git 协议的 Cloudflare 特定头部
  headers.delete('CF-Connecting-IP');
  headers.delete('CF-IPCountry');
  headers.delete('CF-Ray');
  headers.delete('CF-Visitor');
  headers.delete('CF-Worker');
  headers.delete('X-Forwarded-For');
  headers.delete('X-Real-IP');
  headers.delete('X-Forwarded-Proto');
  headers.delete('X-Forwarded-Host');

  // 删除 AWS S3 相关头部（不相关）
  headers.delete('x-amz-content-sha256');
  headers.delete('x-amz-date');
  headers.delete('x-amz-security-token');
  headers.delete('x-amz-user-agent');

  return headers;
}

async function handleRequest(request, redirectCount = 0) {
  const MAX_REDIRECTS = 5; // 最大重定向次数
  const url = new URL(request.url);
  let path = url.pathname;

  // 记录请求信息
  console.log(`Request: ${request.method} ${path}`);

  // 首页路由
  if (path === '/' || path === '') {
    return new Response(HOMEPAGE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // 处理 Docker V2 API 或 GitHub 代理请求
  let isV2Request = false;
  let v2RequestType = null; // 'manifests' or 'blobs'
  let v2RequestTag = null;  // tag or digest
  if (path.startsWith('/v2/')) {
    isV2Request = true;
    path = path.replace('/v2/', '');

    // 解析 V2 API 请求类型和标签/摘要
    const pathSegments = path.split('/').filter(part => part);
    if (pathSegments.length >= 3) {
      // 格式如: nginx/manifests/latest 或 nginx/blobs/sha256:xxx
      v2RequestType = pathSegments[pathSegments.length - 2];
      v2RequestTag = pathSegments[pathSegments.length - 1];
      // 提取镜像名称部分（去掉 manifests/tag 或 blobs/digest 部分）
      path = pathSegments.slice(0, pathSegments.length - 2).join('/');
    }
  }

  // 提取目标域名和路径
  const pathParts = path.split('/').filter(part => part);
  if (pathParts.length < 1) {
    // 如果 path 为空（如请求 /v2/），返回 Docker Registry 版本信息
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Docker-Distribution-API-Version': 'registry/2.0'
      }
    });
  }

  let targetDomain, targetPath, isDockerRequest = false;

  // 检查路径是否以 https:// 或 http:// 开头
  // 注意：需要包含原始请求的查询参数（如 ?service=git-upload-pack），否则会丢失
  const fullPath = (path.startsWith('/') ? path.substring(1) : path) + url.search;

  if (fullPath.startsWith('https://') || fullPath.startsWith('http://')) {
    // 处理 /https://domain.com/... 或 /http://domain.com/... 格式
    const urlObj = new URL(fullPath);
    targetDomain = urlObj.hostname;
    targetPath = urlObj.pathname.substring(1) + urlObj.search; // 移除开头的斜杠

    // 检查是否为 Docker 请求
    isDockerRequest = ['quay.io', 'gcr.io', 'k8s.gcr.io', 'registry.k8s.io', 'ghcr.io', 'docker.cloudsmith.io', 'registry-1.docker.io', 'docker.io'].includes(targetDomain);

    // 处理 docker.io 域名，转换为 registry-1.docker.io
    if (targetDomain === 'docker.io') {
      targetDomain = 'registry-1.docker.io';
    }


  } else {
    // 处理 Docker 镜像路径的多种格式
    if (pathParts[0] === 'docker.io') {
      // 处理 docker.io/library/nginx 或 docker.io/amilys/embyserver 格式
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';

      if (pathParts.length === 2) {
        // 处理 docker.io/nginx 格式，添加 library 命名空间
        targetPath = `library/${pathParts[1]}`;
      } else {
        // 处理 docker.io/amilys/embyserver 或 docker.io/library/nginx 格式
        targetPath = pathParts.slice(1).join('/');
      }
    } else if (ALLOWED_HOSTS.includes(pathParts[0])) {
      // Docker 镜像仓库（如 ghcr.io）或 GitHub 域名（如 github.com）
      targetDomain = pathParts[0];
      targetPath = pathParts.slice(1).join('/') + url.search;
      isDockerRequest = ['quay.io', 'gcr.io', 'k8s.gcr.io', 'registry.k8s.io', 'ghcr.io', 'docker.cloudsmith.io', 'registry-1.docker.io'].includes(targetDomain);
    } else if (pathParts.length >= 1 && pathParts[0] === 'library') {
      // 处理 library/nginx 格式
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';
      targetPath = pathParts.join('/');
    } else if (pathParts.length >= 2) {
      // 处理 amilys/embyserver 格式（带命名空间但不是 library）
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';
      targetPath = pathParts.join('/');
    } else {
      // 处理单个镜像名称，如 nginx
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';
      targetPath = `library/${pathParts.join('/')}`;
    }
  }

  // 默认白名单检查：只允许 ALLOWED_HOSTS 中的域名
  if (!ALLOWED_HOSTS.includes(targetDomain)) {
    console.log(`Blocked: Domain ${targetDomain} not in allowed list`);
    return new Response(`Error: Invalid target domain.\n`, { status: 400 });
  }

  // 路径白名单检查（仅当 RESTRICT_PATHS = true 时）
  if (RESTRICT_PATHS) {
    const checkPath = isDockerRequest ? targetPath : path;
    console.log(`Checking whitelist against path: ${checkPath}`);
    const isPathAllowed = ALLOWED_PATHS.some(pathString =>
      checkPath.toLowerCase().includes(pathString.toLowerCase())
    );
    if (!isPathAllowed) {
      console.log(`Blocked: Path ${checkPath} not in allowed paths`);
      return new Response(`Error: The path is not in the allowed paths.\n`, { status: 403 });
    }
  }

  // 构建目标 URL
  let targetUrl;
  if (isDockerRequest) {
    if (isV2Request && v2RequestType && v2RequestTag) {
      // 重构 V2 API URL
      targetUrl = `https://${targetDomain}/v2/${targetPath}/${v2RequestType}/${v2RequestTag}`;
    } else {
      targetUrl = `https://${targetDomain}/${isV2Request ? 'v2/' : ''}${targetPath}`;
    }
  } else {
    targetUrl = `https://${targetDomain}/${targetPath}`;
  }

  // 检测是否为 Git smart-http 请求
  const isGit = isGitRequest(request, targetDomain);

  let newRequestHeaders;
  if (isGit) {
    // Git 请求：使用白名单方式保留关键头部，避免 Cloudflare 添加的额外头部干扰 Git 协议
    newRequestHeaders = buildGitHeaders(request, targetDomain);
  } else {
    newRequestHeaders = new Headers(request.headers);
    newRequestHeaders.set('Host', targetDomain);
    newRequestHeaders.delete('x-amz-content-sha256');
    newRequestHeaders.delete('x-amz-date');
    newRequestHeaders.delete('x-amz-security-token');
    newRequestHeaders.delete('x-amz-user-agent');

    if (isAmazonS3(targetUrl)) {
      newRequestHeaders.set('x-amz-content-sha256', getEmptyBodySHA256());
      newRequestHeaders.set('x-amz-date', new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z');
    }
  }

  try {
    // Snippets 不支持 redirect: 'manual'，统一使用 'follow' 模式
    // Git 请求使用 follow 重定向，让 Cloudflare 自动跟随重定向
    // 非 Git 请求也使用 follow，后续通过 response.redirected 检测重定向

    console.log(`Fetching: ${request.method} ${targetUrl} (docker=${isDockerRequest}, git=${isGit})`);
    console.log(`Request headers Host: ${newRequestHeaders.get('Host')}`);

    // 直接使用 fetch(url, options) 方式，与 _worker.js 保持一致
    // 不设置 redirect 选项，Snippets 默认使用 'follow'
    // 对于 GET/HEAD 请求不传 body，避免 Snippets 运行时对 ReadableStream 的限制
    const fetchOptions = {
      method: request.method,
      headers: newRequestHeaders
    };
    // 只有非 GET/HEAD 请求才传 body
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body;
    }

    let response = await fetch(targetUrl, fetchOptions);
    console.log(`Initial response: ${response.status} ${response.statusText} [git=${isGit}]`);

    // 处理 Docker 认证挑战
    if (isDockerRequest && response.status === 401) {
      const wwwAuth = response.headers.get('WWW-Authenticate');
      if (wwwAuth) {
        const authMatch = wwwAuth.match(/Bearer realm="([^"]+)",service="([^"]*)",scope="([^"]*)"/);
        if (authMatch) {
          const [, realm, service, scope] = authMatch;
          console.log(`Auth challenge: realm=${realm}, service=${service || targetDomain}, scope=${scope}`);

          const token = await handleToken(realm, service || targetDomain, scope);
          if (token) {
            const authHeaders = new Headers(request.headers);
            authHeaders.set('Authorization', `Bearer ${token}`);
            authHeaders.set('Host', targetDomain);
            // 如果目标是 S3，添加必要的 x-amz 头；否则删除可能干扰的头部
            if (isAmazonS3(targetUrl)) {
              authHeaders.set('x-amz-content-sha256', getEmptyBodySHA256());
              authHeaders.set('x-amz-date', new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z');
            } else {
              authHeaders.delete('x-amz-content-sha256');
              authHeaders.delete('x-amz-date');
              authHeaders.delete('x-amz-security-token');
              authHeaders.delete('x-amz-user-agent');
            }

            const authOpts = {
              method: request.method,
              headers: authHeaders
            };
            if (request.method !== 'GET' && request.method !== 'HEAD') {
              authOpts.body = request.body;
            }
            console.log('Retrying with token');
            response = await fetch(targetUrl, authOpts);
            console.log(`Token response: ${response.status} ${response.statusText}`);
          } else {
            console.log('No token acquired, falling back to anonymous request');
            const anonHeaders = new Headers(request.headers);
            anonHeaders.delete('Authorization');
            anonHeaders.set('Host', targetDomain);
            // 如果目标是 S3，添加必要的 x-amz 头；否则删除可能干扰的头部
            if (isAmazonS3(targetUrl)) {
              anonHeaders.set('x-amz-content-sha256', getEmptyBodySHA256());
              anonHeaders.set('x-amz-date', new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z');
            } else {
              anonHeaders.delete('x-amz-content-sha256');
              anonHeaders.delete('x-amz-date');
              anonHeaders.delete('x-amz-security-token');
              anonHeaders.delete('x-amz-user-agent');
            }

            const anonOpts = {
              method: request.method,
              headers: anonHeaders
            };
            if (request.method !== 'GET' && request.method !== 'HEAD') {
              anonOpts.body = request.body;
            }
            response = await fetch(targetUrl, anonOpts);
            console.log(`Anonymous response: ${response.status} ${response.statusText}`);
          }
        } else {
          console.log('Invalid WWW-Authenticate header');
        }
      } else {
        console.log('No WWW-Authenticate header in 401 response');
      }
    }

    // 处理 S3 重定向（Docker 镜像层）
    // 在 follow 模式下，307/302 已被自动跟随，但我们需要确保 S3 请求头正确
    if (isDockerRequest && response.redirected && isAmazonS3(response.url)) {
      console.log(`S3 redirect detected: ${response.url}`);

      // 重新请求 S3，手动添加必要的请求头
      const s3Headers = new Headers(request.headers);
      s3Headers.set('Host', new URL(response.url).hostname);

      const EMPTY_BODY_SHA256 = getEmptyBodySHA256();
      s3Headers.set('x-amz-content-sha256', EMPTY_BODY_SHA256);
      s3Headers.set('x-amz-date', new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z');

      // 如果原始响应有 Authorization 头，传递它
      if (response.headers.get('Authorization')) {
        s3Headers.set('Authorization', response.headers.get('Authorization'));
      }

      const s3Opts = {
        method: request.method,
        headers: s3Headers
      };
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        s3Opts.body = request.body;
      }

      response = await fetch(response.url, s3Opts);
      console.log(`S3 response: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        console.log('S3 request failed, returning original response');
        return new Response(response.body, {
          status: response.status,
          headers: response.headers
        });
      }
    }

    // 复制响应并添加 CORS 头
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');

    if (isDockerRequest) {
      newResponse.headers.set('Docker-Distribution-API-Version', 'registry/2.0');
      // 删除可能存在的重定向头，确保所有请求都通过Worker处理
      newResponse.headers.delete('Location');
    }

    // Git smart-http 特殊处理：
    // 1. 保留 Location 头（Git 需要处理重定向）
    // 2. 保留原始 Content-Type（如 application/x-git-upload-pack-advertisement）
    // 3. 保留 Transfer-Encoding（Git 需要 chunked 编码）
    if (isGit) {
      // Git 需要原始的响应头，不要删除 Location
      // 确保 Content-Type 不被修改
      const contentType = response.headers.get('Content-Type');
      if (contentType && contentType.includes('x-git-')) {
        // Git smart-http 响应，保持原样
        console.log(`Git smart-http response: ${response.status} ${contentType}`);
      }
    }

    return newResponse;
  } catch (error) {
    // 诊断：打印完整错误对象
    const errorType = typeof error;
    const errorStr = error ? (error.stack || error.message || JSON.stringify(error) || String(error) || 'no details') : 'error was null/undefined';
    console.log(`Fetch error type=${errorType}, detail=${errorStr}`);
    return new Response(`Error fetching from ${targetDomain}: ${errorStr}\n`, { status: 500 });
  }
}

// Snippets 入口 — 使用 export default，与 Workers 相同的模块格式
// 注意：Snippets 运行时也使用 ESM 模块，需要 export default
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request);
  }
};