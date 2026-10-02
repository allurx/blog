/**
 * 增强代码块复制操作，成功反馈留在按钮内，失败时展示可操作的说明。
 */
export function initializeCodeCopy(): void {
    const copyStatus = document.querySelector<HTMLElement>("#copy-status");
    for (const button of document.querySelectorAll<HTMLButtonElement>(".code-copy")) {
        const block = button.closest(".code-block");
        const code = block?.querySelector("code");
        const feedback = block?.querySelector<HTMLElement>(".code-feedback");
        const label = button.querySelector<HTMLElement>(".copy-label");
        if (!code || !feedback || !label) continue;

        let resetTimer: number | undefined;
        button.hidden = false;
        button.addEventListener("click", async () => {
            window.clearTimeout(resetTimer);
            button.disabled = true;
            button.setAttribute("aria-busy", "true");
            delete button.dataset.copied;
            label.textContent = "复制中…";
            feedback.hidden = true;

            try {
                await navigator.clipboard.writeText(code.textContent ?? "");
                label.textContent = "已复制";
                button.dataset.copied = "true";
                feedback.textContent = "已复制到剪贴板。";
                resetTimer = window.setTimeout(() => {
                    label.textContent = "复制";
                    delete button.dataset.copied;
                }, 2200);
            } catch {
                label.textContent = "复制";
                feedback.textContent = "自动复制未成功，请选择代码后手动复制。";
                feedback.dataset.result = "error";
                feedback.hidden = false;
            } finally {
                button.disabled = false;
                button.removeAttribute("aria-busy");
                copyStatus?.replaceChildren(document.createTextNode(feedback.textContent ?? ""));
            }
        });
    }
}
