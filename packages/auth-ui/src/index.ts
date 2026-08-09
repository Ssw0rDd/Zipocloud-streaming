import { ZipoApiError, createApiClient, type AuthSession } from "@zipo/api-client";
import { authStyles } from "./styles";

type AuthView = "sign-in" | "sign-up";
type Locale = "pt" | "en";

const HTMLElementBase = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

const copy = {
  pt: {
    access: "Acesso ZiPo",
    titleIn: "Volte para a sessão.",
    titleUp: "Abra sua sessão.",
    intro: "Sua lista, perfis e progresso continuam no mesmo lugar.",
    signIn: "Entrar",
    signUp: "Criar conta",
    name: "Como devemos chamar você?",
    email: "E-mail",
    password: "Senha",
    passwordHint: "Use pelo menos 15 caracteres.",
    submitIn: "Continuar",
    submitUp: "Criar minha conta",
    working: "Validando…",
    failure: "Não foi possível autenticar. Revise os dados e tente novamente.",
    legal: "A sessão usa cookie seguro. A senha nunca é salva neste componente.",
  },
  en: {
    access: "ZiPo access",
    titleIn: "Return to your session.",
    titleUp: "Open your session.",
    intro: "Your lists, profiles and progress are waiting in the same place.",
    signIn: "Sign in",
    signUp: "Create account",
    name: "What should we call you?",
    email: "Email",
    password: "Password",
    passwordHint: "Use at least 15 characters.",
    submitIn: "Continue",
    submitUp: "Create my account",
    working: "Checking…",
    failure: "Authentication failed. Review the fields and try again.",
    legal: "The session uses a secure cookie. This component never stores your password.",
  },
} as const;

export interface ZipoAuthSuccessDetail { session: AuthSession; view: AuthView }
export interface ZipoAuthErrorDetail { code: string; status: number }

export function safeSameOriginRedirect(raw: string | null, origin: string): string | null {
  if (!raw) return null;
  try {
    const value = new URL(raw, origin);
    return value.origin === origin ? value.href : null;
  } catch {
    return null;
  }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  if (className) value.className = className;
  return value;
}

export class ZipoAuthElement extends HTMLElementBase {
  static observedAttributes = ["api-base", "brand", "locale", "mode", "redirect-url"];
  private view: AuthView = "sign-in";
  private busy = false;

  constructor() {
    super();
    if (typeof document !== "undefined" && !this.shadowRoot) this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.render();
  }

  private get locale(): Locale {
    return this.getAttribute("locale")?.toLowerCase() === "en" ? "en" : "pt";
  }

  private get mode(): "both" | AuthView {
    const mode = this.getAttribute("mode");
    return mode === "sign-in" || mode === "sign-up" ? mode : "both";
  }

  private setView(view: AuthView): void {
    if (this.busy || (this.mode !== "both" && this.mode !== view)) return;
    this.view = view;
    this.render();
  }

  private field(labelText: string, type: "text" | "email" | "password", name: string): HTMLLabelElement {
    const label = node("label");
    label.append(document.createTextNode(labelText));
    const input = node("input");
    input.type = type;
    input.name = name;
    input.required = true;
    input.autocomplete = name === "name" ? "name" : name === "email" ? "email" : this.view === "sign-up" ? "new-password" : "current-password";
    if (type === "password") {
      input.minLength = 15;
      input.maxLength = 128;
    }
    if (type === "email") input.spellcheck = false;
    label.append(input);
    return label;
  }

  private async submit(form: HTMLFormElement, status: HTMLParagraphElement, button: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    button.disabled = true;
    const labels = copy[this.locale];
    button.firstChild!.textContent = labels.working;
    status.textContent = "";

    const values = new FormData(form);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    const client = createApiClient({ baseUrl: this.getAttribute("api-base") ?? "" });
    try {
      const session = this.view === "sign-up"
        ? await client.signUp({ name: String(values.get("name") ?? "").trim(), email, password })
        : await client.signIn({ email, password });
      this.dispatchEvent(new CustomEvent<ZipoAuthSuccessDetail>("zipo-auth-success", {
        bubbles: true,
        composed: true,
        detail: { session, view: this.view },
      }));
      if (typeof location !== "undefined") {
        const redirect = safeSameOriginRedirect(this.getAttribute("redirect-url"), location.origin);
        if (redirect) location.assign(redirect);
      }
    } catch (error) {
      status.textContent = labels.failure;
      const detail: ZipoAuthErrorDetail = error instanceof ZipoApiError
        ? { code: error.code, status: error.status }
        : { code: "UNKNOWN_ERROR", status: 0 };
      this.dispatchEvent(new CustomEvent<ZipoAuthErrorDetail>("zipo-auth-error", {
        bubbles: true,
        composed: true,
        detail,
      }));
    } finally {
      this.busy = false;
      button.disabled = false;
      button.firstChild!.textContent = this.view === "sign-up" ? labels.submitUp : labels.submitIn;
    }
  }

  private render(): void {
    const root = this.shadowRoot;
    if (!root || typeof document === "undefined") return;
    if (this.mode !== "both") this.view = this.mode;
    root.replaceChildren();
    const labels = copy[this.locale];
    const style = node("style");
    style.textContent = authStyles;
    const shell = node("section", "shell");
    shell.setAttribute("aria-label", labels.access);

    const masthead = node("header", "masthead");
    const eyebrow = node("p", "eyebrow");
    eyebrow.textContent = this.getAttribute("brand")?.trim().slice(0, 40) || labels.access;
    const title = node("h1");
    title.textContent = this.view === "sign-up" ? labels.titleUp : labels.titleIn;
    const intro = node("p", "intro");
    intro.textContent = labels.intro;
    masthead.append(eyebrow, title, intro);
    shell.append(masthead);

    if (this.mode === "both") {
      const tabs = node("div", "tabs");
      tabs.setAttribute("role", "tablist");
      for (const [view, text] of [["sign-in", labels.signIn], ["sign-up", labels.signUp]] as const) {
        const tab = node("button", "tab");
        tab.type = "button";
        tab.role = "tab";
        tab.setAttribute("aria-selected", String(this.view === view));
        tab.textContent = text;
        tab.addEventListener("click", () => this.setView(view));
        tabs.append(tab);
      }
      shell.append(tabs);
    }

    const form = node("form");
    form.noValidate = false;
    if (this.view === "sign-up") form.append(this.field(labels.name, "text", "name"));
    form.append(this.field(labels.email, "email", "email"));
    form.append(this.field(`${labels.password} — ${labels.passwordHint}`, "password", "password"));
    const status = node("p", "status");
    status.role = "alert";
    status.setAttribute("aria-live", "polite");
    const action = node("button", "action");
    action.type = "submit";
    action.append(document.createTextNode(this.view === "sign-up" ? labels.submitUp : labels.submitIn));
    form.append(status, action);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (form.reportValidity()) void this.submit(form, status, action);
    });
    shell.append(form);

    const legal = node("p", "fine-print");
    legal.textContent = labels.legal;
    shell.append(legal);
    root.append(style, shell);
  }
}

export function defineZipoAuthElement(tagName = "zipo-auth"): void {
  if (typeof customElements !== "undefined" && !customElements.get(tagName)) {
    customElements.define(tagName, ZipoAuthElement);
  }
}

defineZipoAuthElement();

declare global {
  interface HTMLElementTagNameMap { "zipo-auth": ZipoAuthElement }
}
