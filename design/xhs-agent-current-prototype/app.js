const screens = {
  overview: ['总览地图', '信息架构、页面清单和核心工作流总览。'],
  login: ['登录注册', '登录/注册入口和 ProtectedRoute 鉴权状态。'],
  variations: ['设计方向', '三套视觉方向、位置四问和最终取舍。'],
  motion: ['动效系统', 'Agent 工具链、图片生成、模型 fallback 和诊断评分的动态美学。'],
  chat: ['创作对话', 'ChatGPT 式对话、历史侧栏、笔记上下文、图片上传和工具链展示。'],
  articles: ['笔记列表', '搜索、筛选、排序、管理员用户分组和笔记状态。'],
  editor: ['笔记编辑器', '三栏可拖拽编辑工作台、图片队列、手机预览、Agent 操作。'],
  diagnose: ['发布前诊断', '后台诊断、历史结果、专家评估和一键应用优化方案。'],
  templates: ['模板库', '模板创建、删除、套用和从笔记提取模板。'],
  analytics: ['数据页', '总量、状态、热门标签和月历发布视图。'],
  tasks: ['任务中心', '后台任务列表、trace、事件计数、取消和刷新。'],
  settings: ['设置页', '模型队列、静态公网测试、真实生图测试、账号与管理员配置。'],
  'hidden-lab': ['隐藏图片实验', '未挂路由的图片拆层和实验编辑器能力。'],
};
const featureMap = [
  ['登录 / 注册','/login','Tab 切换、错误反馈、鉴权重定向'],['设计方向','prototype','三套设计哲学、位置四问、推荐路线和取舍'],['动效系统','prototype','Slow-Fast-Boom-Stop 节奏、Agent 工具链、图片生成、模型 fallback'],['创作对话','/','历史侧栏、批量删除、选中笔记、图片上传、后台任务续跑'],['笔记列表','/articles','搜索筛选、排序、管理员按用户分组、评分和图片数'],['笔记编辑器','/articles/:id','三栏拖拽、图片队列、首图即封面、违禁词、自动保存、发布'],['发布前诊断','/articles/:id/diagnose','后台诊断、历史结果、应用优化方案、专家争议'],['模板库','/templates','创建、删除、套用、从笔记提取模板'],['数据页','/analytics','统计卡、标签柱图、状态环图、月历'],['任务中心','/tasks','任务状态、trace、取消、刷新'],['设置页','/settings','模型拖拽队列、URL/quality 能力、静态公网测试、用户管理'],['命令面板','Ctrl/Cmd+K','页面/笔记搜索和键盘导航'],['图片编辑器','弹窗','裁剪、局部重绘、消除、整体变体'],['AI 图片实验页','隐藏','像素/语义拆层、图层拖动和实验性编辑']
];
function renderMap(){
  const box=document.getElementById('page-map');
  box.innerHTML=featureMap.map(([title,route,desc])=>`<div class="map-card"><b>${title}</b><p>${desc}</p><span>${route}</span></div>`).join('');
}
function showScreen(name, syncHash=true){
  if(!screens[name]) name='overview';
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+name)?.classList.add('active');
  document.querySelectorAll('.nav-item[data-screen]').forEach(b=>b.classList.toggle('active',b.dataset.screen===name));
  document.getElementById('screen-title').textContent=screens[name]?.[0]||name;
  document.getElementById('screen-desc').textContent=screens[name]?.[1]||'';
  if(syncHash && location.hash.replace('#','')!==name) history.replaceState(null,'','#'+name);
}
document.querySelectorAll('[data-screen]').forEach(el=>el.addEventListener('click',()=>showScreen(el.dataset.screen)));
window.addEventListener('hashchange',()=>showScreen(location.hash.replace('#',''), false));
function openModal(id){document.getElementById(id)?.classList.add('open')}
function closeModal(e){if(e.target.classList.contains('modal')||e.target.classList.contains('modal-close')) e.target.closest('.modal')?.classList.remove('open')}
document.getElementById('open-command').onclick=()=>openModal('command-modal');
document.getElementById('open-onboarding').onclick=()=>openModal('onboarding-modal');
document.getElementById('open-image-editor').onclick=()=>openModal('image-editor-modal');
document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',closeModal));
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openModal('command-modal')} if(e.key==='Escape')document.querySelectorAll('.modal.open').forEach(m=>m.classList.remove('open'))});
const cal=document.getElementById('calendar'); if(cal){ for(let i=1;i<=35;i++){const d=document.createElement('div');d.className='day '+([3,6,9,15,16,22,29].includes(i)?'hot':'');d.textContent=String(i);cal.appendChild(d)} }
renderMap();
showScreen(location.hash.replace('#','') || 'overview', false);
