import { describe, expect, it } from "vitest";
import { getSystemInstruction } from "@/lib/gemini";

describe("política de verificação IArgos", () => {
  it("carrega o Markdown real como instrução do Gemini", () => {
    const policy = getSystemInstruction();
    expect(policy.length).toBeGreaterThan(1000);
    expect(policy).toContain("QUEM CRIOU?");
    expect(policy).toContain("QUAL A FONTE?");
    expect(policy).toContain("QUAL O INTERESSE?");
  });

  it("exige corroboração e inclui o contrato da resposta", () => {
    const policy = getSystemInstruction();
    expect(policy).toContain("republica");
    expect(policy).toContain("Inconclusiva");
    expect(policy).toContain('"quem_criou"');
    expect(policy).toContain('"qual_a_fonte"');
    expect(policy).toContain('"qual_o_interesse"');
    expect(policy).toContain('"notas_fontes"');
  });
});
