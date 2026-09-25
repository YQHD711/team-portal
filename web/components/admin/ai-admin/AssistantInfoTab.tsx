import { BookOpen, Eye, ShieldCheck, Wrench } from "lucide-react";
import type { AgentTool, GuideSection } from "./aiAdminTypes";

interface Props {
  tools: AgentTool[];
  guide: GuideSection[];
}

/** 能力与手册 Tab：说明这个助手能看什么、不能做什么，并列出工具清单与管理员手册。 */
export default function AssistantInfoTab({ tools, guide }: Props) {
  const boundaries = [
    { icon: Eye, title: "只读", text: "全部工具只读取数据，不会修改任何数据、文件或设置。" },
    { icon: ShieldCheck, title: "不改代码", text: "不给代码补丁、不提代码提案，也不做源码检索。" },
    { icon: Wrench, title: "不编译不重启", text: "没有编译、应用变更、重启服务的入口。" },
    { icon: BookOpen, title: "改代码走发布流程", text: "分支 → PR → CI 通过 → 合并 main → 自动部署（约 5 分钟轮询）。" },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500" />能力边界</h3>
        <div className="grid gap-3 sm:grid-cols-2 mt-3">
          {boundaries.map(b => (
            <div key={b.title} className="flex gap-2.5 rounded-xl border border-border p-3">
              <b.icon className="h-4 w-4 mt-0.5 shrink-0 text-muted" />
              <div>
                <div className="text-sm font-medium">{b.title}</div>
                <p className="text-xs text-muted mt-0.5 leading-relaxed">{b.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Wrench className="h-4 w-4 text-purple-500" />可用工具
          <span className="text-xs font-normal text-muted">（共 {tools.length} 个，全部只读）</span>
        </h3>
        {tools.length === 0 ? (
          <p className="text-sm text-muted mt-3">工具清单加载失败或暂时不可用。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {tools.map(t => (
              <li key={t.name} className="rounded-xl border border-border p-3">
                <code className="text-xs font-medium text-purple-600 dark:text-purple-400">{t.name}</code>
                <p className="text-xs text-muted mt-1 leading-relaxed">{t.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-blue-500" />管理员手册
          <span className="text-xs font-normal text-muted">（助手回答操作问题时会先查这里）</span>
        </h3>
        {guide.length === 0 ? (
          <p className="text-sm text-muted mt-3">手册加载失败或暂时不可用。</p>
        ) : (
          <div className="mt-3 space-y-2">
            {guide.map(g => (
              <details key={g.topic} className="rounded-xl border border-border p-3 group">
                <summary className="cursor-pointer text-sm font-medium list-none flex items-center justify-between">
                  {g.topic}
                  <span className="text-xs text-muted group-open:hidden">展开</span>
                  <span className="text-xs text-muted hidden group-open:inline">收起</span>
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-muted leading-relaxed font-sans">{g.content}</pre>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
