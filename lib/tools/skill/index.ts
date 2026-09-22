// ============================================================
// skill —— 加载一个技能的正文（C8）
// ============================================================
// ⚠️ **这是本功能唯一绕过工作区围栏的地方。**
//
// `lib/tools/` 里所有文件工具都先过 `resolveInsideWorkspace` ——
// "agent 只能在工作区里动文件"是一条**结构保证**（见 path-utils/index.ts）。
// 而技能根（`~/.agents/skills`）在**工作区之外**，所以这个工具的工厂
// **不接 `workspaceRoot`**、也不走那个围栏：它只读自己那一个根下的
// SKILL.md，读不到别的任何地方。
//
// 为什么不能干脆用 `read_file`：它被围栏关在工作区内，读不到技能根
// （C8 根决策的原文理由）。所以这一层的"越界"是**受控的**：一个根、
// 只读 SKILL.md、路径由目录名拼出来（名字来自我们扫出来的目录列表，
// 不是模型给的自由路径）。
// ============================================================

import type { RegisteredTool } from "../types";
import { stringArg } from "../path-utils";
import {
  findSkill,
  loadSkills,
  MAX_LISTED_FILES,
  renderSkillContent,
} from "../../skill";
import { text } from "../../message";

/**
 * 工具描述 = 模型唯一的入口线索，措辞直接决定它会不会在正确的时机调用。
 *
 * 三段各有用处：
 *   1. **硬时序**（"在…之前先加载"）—— 抄 DSH，不抄 pi 的软条件版
 *      （pi 自己在文档里承认模型常常不照做）
 *   2. **资源怎么拿** —— 正文里的相对路径相对哪解析、脚本要跑得走 bash
 *      （会弹审批，这是我们认下的摩擦）
 *   3. **两条红线** —— 依赖缺失如实报告 / 不许自己 pip·npm install。
 *      写成描述而不是提示词，因为它是"要保证的事"，不是"提示一下"。
 */
const DESCRIPTION = [
  "加载一个技能（Skill）的完整说明。可用技能的清单在系统提示词里（名字 + 用途）。",
  "在开始一项「指名了某个技能」或「任务明确匹配某个技能」的工作之前，先用这个工具把它加载进来——不要凭技能名猜它写了什么。",
  "参数 name 必须是清单里的名字（技能的身份是它的目录名，例如 code-review）。",
  "返回：技能正文、技能目录的绝对路径、目录下的文件清单。正文里提到的相对路径相对那个目录解析；要用到的脚本与参考文件按需再取（脚本用 bash 跑，每次都会弹审批）。",
  "两条硬要求：① 依赖缺失（例如某个 Python 包没装）就如实报告，不要假装成功；② 不要自己执行 pip install / npm install——装依赖由人来决定。",
].join("\n");

/**
 * @param skillsRoot 技能根（**由调用方传进来**，工具自己不读配置）：
 *   将来技能根变成多根时，要改的是"谁把它传进来"，不是这个工具的职责。
 */
export function createSkillTool(skillsRoot: string): RegisteredTool {
  return {
    name: "skill",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "技能名（技能清单里的名字，= 技能目录名），例如 code-review。",
        },
      },
      required: ["name"],
    },
    async execute(args) {
      const name = stringArg(args.name, "");
      if (name === "") {
        throw new Error("缺少参数 name：要加载哪个技能？用技能清单里的名字。");
      }

      // 每次执行现扫：技能是用户随时会改的文件，缓存换不来可感知的收益
      // （实测热态 3.9ms），却要处理失效。
      const { skills } = loadSkills(skillsRoot);
      const skill = findSkill(skills, name);
      if (!skill) {
        throw new Error(
          `没有叫 "${name}" 的技能（名字打错了，或者这个技能已经不在技能目录里了）。可用技能见系统提示词里的清单。`,
        );
      }
      if (!skill.modelInvocable) {
        // 抄 DSH（dsh-tool-skill/lib/index.js:147）：作者写了
        // disable-model-invocation 就**不许模型自己喊**——否则这个开关
        // 等于不存在。用户仍可以用 /名字 触发（手势路径是另一条）。
        throw new Error(
          `技能 "${name}" 没有开放给模型自己加载（它的 SKILL.md 写了 disable-model-invocation）。如果用户需要它，请让用户直接用 /${name} 触发。`,
        );
      }

      return {
        content: [text(renderSkillContent(skill))],
        // 结构化版本：模型看不到，给前端 / 轨迹 / 测试用（写文件工具回传 path 的同款先例）
        details: {
          name: skill.name,
          baseDir: skill.baseDir,
          files: skill.files.slice(0, MAX_LISTED_FILES),
        },
      };
    },
  };
}
