/*
 * Run with Node.js 24:
 *   node grapheme-demo.mjs
 */

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

const samples = [
    ["ASCII", "A"],
    ["emoji", "😀"],
    ["decomposed", "e\u0301"],
    ["family", "👨‍👩‍👧‍👦"],
    ["flag", "🇨🇳"],
];

console.log("name        units points graphemes value");
for (const [name, value] of samples) {
    const codeUnits = value.length;
    const codePoints = [...value].length;
    const graphemes = [...segmenter.segment(value)].length;
    console.log(
        `${name.padEnd(11)} ${String(codeUnits).padStart(5)} ${String(codePoints).padStart(6)} ${String(graphemes).padStart(9)} ${value}`
    );
}

const message = "A👨‍👩‍👧‍👦e\u0301🇨🇳";
const firstThree = [...segmenter.segment(message)]
    .slice(0, 3)
    .map(({ segment }) => segment)
    .join("");

console.log(`first 3 graphemes: ${firstThree}`);
