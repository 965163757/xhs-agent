"""多 Agent 诊断引擎：4 个专家 Agent 并行评估 + 辩论 + 裁判汇总。"""
from .orchestrator import run_diagnosis, DiagnosisResult

__all__ = ["run_diagnosis", "DiagnosisResult"]
