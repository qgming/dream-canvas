import { useId } from "react";

const glyphRows = [
    "a7Kx02mQ9vB4nR8cF1sD6wH3pL5zT",
    "X3fN8rV1kY6bJ0uC7eM4hS9qA2dG",
    "0nW5tL2gP8xE3cR7mZ1vK6aF4jB9",
    "qH6sD9yA4uN0bT5iG2pX8rC1eM7w",
    "V2kF7zQ0dJ5nS8aL3xB6mR9cE4hP",
    "8uC1rY6fW3pG9tK2vN5sA0bH7eD4",
    "mZ4xB8jR1cL6qF0wT9nE3aV5kS2g",
    "J9dP3hM7sX2eA5rC8yN1uG6bQ0tK",
];
const glyphs = glyphRows.join("");

export function AsciiLogo() {
    const id = useId();
    const mask = `${id}-mask`;
    return <svg viewBox="0 0 552 552" className="landing-hero-logo" aria-hidden="true" focusable="false">
        <defs>
            <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="552" height="552" style={{ maskType: "alpha" }}>
                <image href="/logo.svg" width="552" height="552" />
            </mask>
        </defs>
        <g mask={`url(#${mask})`} fontFamily="Menlo, ui-monospace, SFMono-Regular, Consolas, monospace" fontSize="10" fill="currentColor">
            {Array.from({ length: 46 }, (_, index) => {
                const offset = index * 19 % glyphs.length;
                return <text key={index} x="0" y={index * 12 + 10} textLength="552" lengthAdjust="spacingAndGlyphs">{glyphs.repeat(2).slice(offset, offset + 92)}</text>;
            })}
        </g>
    </svg>;
}
