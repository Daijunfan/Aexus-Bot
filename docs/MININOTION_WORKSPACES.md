# MiniNotion 1.21.0：页面树与文件夹树一一对应

## 唯一存储规则

使用 `page-folder-tree/v2` 布局。全局工作区由 `fs.info.collectionRoot` 返回；正式安装默认位于 `~/AgentsCompany/workspaces/mini-notion-workspace`。主页面只能对应这个目录的直接子文件夹。每进入一层子文件夹，就进入一层子页面，不忽略 Team 或员工目录，也不把深层页面提升到全局顶层。

```text
mini-notion-workspace/
  项目甲/                          # 主页面，深度 1
    index.mininotion.json
    架构/                          # 子页面，深度 2
      index.mininotion.json
      数据层/                      # 孙页面，深度 3
        index.mininotion.json
    任务库/                        # 数据库页面
      index.mininotion.json         # 属性与多个视图定义
      任务一/                      # 一条记录也是页面
        index.mininotion.json
  项目乙/                          # 另一主页面
    index.mininotion.json
  .mininotion/                     # 内部状态，不是页面
```

所有用户页面和 Agent 页面采用相同格式 `{"format":"mininotion.page/v1","page":{...}}`。新建子页面会自动创建实际子文件夹；原生页面正文、数据库和记录都保存在自己的 `index.mininotion.json`。数据库子项目的物理父目录为父记录，数据库身份仍由 parentId 保存，subItemOf 表示父记录。

普通文件不额外充当页面树节点，在所属页面的“文件”区域预览。`page.list` 保留普通文件预览的 sourceFile 元数据以兼容现有客户端；`page.tree` 默认只返回页面和目录，显式 `files:true` 可附带文件预览。附件、缓存、同步块源、会话和索引是内部数据，不伪装成用户子页面。

## UI 与目录

普通文件夹直接打开统一编辑器，首次编辑时保存原生索引，无需确认“主页面”。查看物理位置使用“页面更多 → 文件位置”。主从角色由目录位置决定，切换页面不会插入目录横幅。

标题修改保留已有目录名。`page.move` 修改父页面时会同步移动整棵物理目录，包括其普通文件、附件和子目录，保持页面 ID。目标同名时分配安全后缀。若某员工恰好绑定了被移动的目录，需用返回的新路径更新其绑定；标题修改不影响绑定。

外部文件工具移动整个目录后，`fs.sync` 以实际目录位置重建父子关系，即使 JSON 中保留了旧 parentId。不要仅修改 JSON 的 parentId 来制造与目录不同的层级。

## CLI 示例

```sh
mininotion fs info
mininotion page create --title '项目甲' --color white
mininotion page create --title '架构' --parent-id ROOT_ID --color white
mininotion page create --title '数据层' --parent-id CHILD_ID --color white
mininotion api page.write-markdown --data @body.json
mininotion fs path --page-id PAGE_ID
mininotion fs audit
```

`body.json` 为 `{"pageId":"PAGE_ID","markdown":"## 说明\n\n正文","mode":"replace"}`。覆盖现有正文前使用 `page.read-markdown PAGE_ID` 返回的 hash 作为 expectedHash。

`fs.path` 返回 absolutePath、absoluteDirectory、parentPageId、collectionRoot、depth、scopeDepth、mainPage。depth 是相对全局集合的实际深度，scopeDepth 是相对当前选定工作目录的深度。绑定子目录后不会把全局 depth 改成 1。

`fs.audit` 是只读验收接口。valid 必须为 true，errors 必须为空；pages 给出逐页面路径及父页面。创建、移动、回收恢复后均应调用它，并用 fs.list 或实际文件树独立核对。

## 员工页面授权

新员工使用普通本地或云端团队，不创建插件团队、不绑定页面目录。用户或 Secretary 在 MiniNotion 的“授权人员”中选择一个或多个页面，分别授予阅读、修改、新增；Secretary 无需授权。员工的引擎会话、执行主机与工作目录不随页面权限改变。

```sh
# 以下在员工自己的认证环境中调用，先由用户或 Secretary 授权页面。
agents plugin resources --id mininotion
agents plugin call mininotion page.get --params '{"pageId":"AUTHORIZED_PAGE_ID"}'
agents plugin call mininotion page.create --params '{"parentId":"AUTHORIZED_PAGE_ID","title":"架构","color":"white"}'
```

新增子页面要求父页面的新增权限，创建者自动获得新页面的后续读写权限；仅允许阅读时不能修改。旧 Work Team 和员工绑定目录继续原位兼容，其目录仍对应页面，不自动搬迁或改名。全局工作区根仅是集合，不能用 fs.bind 把集合本身做成主页面。

## 兼容与验收

旧平铺文件保留读取兼容；`fs.organize` 默认只输出迁移计划，明确传 `dryRun:false` 才整理为逐层文件夹。备份旧数据不会被新工作区自动导入。

`npm --prefix PlugIns/mini-notion test` 检查每个声明的 API 都有成功后端用例。`tests/folder-tree.test.cjs` 核对页面/目录边、子工作区、移动、复制、数据库子项目、回收、重启和回滚；`workspace-layout.test.cjs` 含 160 层实际子文件夹测试。原生 UI 测试必须另行执行，API 覆盖不替代渲染验证。
