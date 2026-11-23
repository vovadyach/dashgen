/** The settings Vite builds into the page, from the build's environment. */
interface ImportMetaEnv {
  /** Cloudflare Turnstile's site key for DashGen's widget, which CI sets for the deployed page (ADR-0021). Unset, the page uses Cloudflare's test key. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
