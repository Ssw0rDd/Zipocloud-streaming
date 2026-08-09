import { Link } from "@/i18n/routing";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="zipo-wordmark text-sm text-zipo-accent">ZiPo</p>
      <h1 className="text-2xl font-semibold text-zipo-text">Você está offline</h1>
      <p className="text-sm text-zipo-muted">
        Sem conexão no momento. Verifique a rede e tente novamente.
      </p>
      <Link href="/" className="btn-primary mt-2">
        Voltar ao início
      </Link>
    </main>
  );
}
