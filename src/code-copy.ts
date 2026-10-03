/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 增强代码块复制操作，成功反馈留在按钮内，失败时展示可操作的说明。
 */
export function initializeCodeCopy(): void {
    // 局域网 HTTP 等环境不提供 Clipboard API，保留原生选择与手动复制。
    if (!window.isSecureContext || !("clipboard" in navigator)) return;
    const copyStatus = document.querySelector<HTMLElement>("#copy-status");
    for (const button of document.querySelectorAll<HTMLButtonElement>(".code-copy")) {
        const block = button.closest(".code-block");
        const code = block?.querySelector("code");
        const feedback = block?.querySelector<HTMLElement>(".code-feedback");
        const label = button.querySelector<HTMLElement>(".copy-label");
        if (!code || !feedback || !label) continue;

        let resetTimer: number | undefined;
        const copyCode = async (): Promise<void> => {
            if (button.getAttribute("aria-busy") === "true") return;
            window.clearTimeout(resetTimer);
            button.setAttribute("aria-busy", "true");
            delete button.dataset["copied"];
            delete feedback.dataset["result"];
            label.textContent = "复制中…";
            feedback.hidden = true;

            try {
                await navigator.clipboard.writeText(code.textContent);
                label.textContent = "已复制";
                button.dataset["copied"] = "true";
                feedback.textContent = "已复制到剪贴板。";
                resetTimer = window.setTimeout(() => {
                    label.textContent = "复制";
                    delete button.dataset["copied"];
                }, 2200);
            } catch {
                label.textContent = "复制";
                feedback.textContent = "自动复制未成功，请选择代码后手动复制。";
                feedback.dataset["result"] = "error";
                feedback.hidden = false;
            } finally {
                button.removeAttribute("aria-busy");
                copyStatus?.replaceChildren(document.createTextNode(feedback.textContent));
            }
        };
        button.addEventListener("click", () => {
            // 复制失败已有界面反馈；其余程序错误交给浏览器的全局错误诊断。
            void copyCode().catch((error: unknown) => {
                window.reportError(error);
            });
        });
        button.removeAttribute("data-pending");
    }
}
