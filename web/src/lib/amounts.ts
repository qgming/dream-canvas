export function decimalAmount(value: string, digits: number) {
    const amount = BigInt(value);
    const scale = BigInt(10) ** BigInt(digits);
    const fraction = (amount % scale).toString().padStart(digits, "0").replace(/0+$/, "");
    return `${amount / scale}${fraction ? `.${fraction}` : ""}`;
}

export function integerAmount(value: string, digits: number) {
    if (!value) return null;
    const [whole, fraction = ""] = value.split(".");
    return (BigInt(whole) * BigInt(10) ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0"))).toString();
}

export function formatAmount(value: string, digits: number, locale: string) {
    const [whole, fraction] = decimalAmount(value, digits).split(".");
    const number = new Intl.NumberFormat(locale, { useGrouping: true }).format(BigInt(whole));
    const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value || ".";
    return `${number}${fraction ? separator + fraction : ""}`;
}
