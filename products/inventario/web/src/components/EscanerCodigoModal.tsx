import { useEffect, useRef, useState } from 'react';
import { BotonSecundario, Modal, NotaError } from '@amg/ui';
import type { IScannerControls } from '@zxing/browser';
import { mensajeDeCamara } from '../lib/camara';

/**
 * Lee un código de barras con la cámara y lo entrega una sola vez.
 *
 * ZXing se carga con `import()` para que el bundle principal no crezca: el
 * lector solo se descarga cuando alguien abre este modal.
 */
export function EscanerCodigoModal({
  onCodigo,
  onCerrar,
}: {
  onCodigo: (codigo: string) => void;
  onCerrar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const leidoRef = useRef(false);
  const onCodigoRef = useRef(onCodigo);
  onCodigoRef.current = onCodigo;

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('sin-soporte');
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelado) return;

        const lector = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanSuccess: 300,
          delayBetweenScanAttempts: 150,
        });
        const controls = await lector.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current ?? undefined,
          (resultado) => {
            if (!resultado || leidoRef.current) return;
            const codigo = resultado.getText().trim();
            if (!codigo) return;
            leidoRef.current = true;
            controlsRef.current?.stop();
            onCodigoRef.current(codigo);
          },
        );

        controlsRef.current = controls;
        if (cancelado || leidoRef.current) controls.stop();
      } catch (e) {
        if (!cancelado) setError(mensajeDeCamara(e));
      }
    })();

    return () => {
      cancelado = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, []);

  return (
    <Modal titulo="Escanear código de barras" onCerrar={onCerrar}>
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-xl bg-slate-900">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline autoPlay />
          {error ? null : (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-1/3 w-3/4 rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.25)]" />
            </div>
          )}
        </div>

        {error ? (
          <NotaError mensaje={error} />
        ) : (
          <p className="text-sm text-slate-500">
            Apuntá la cámara al código de barras. Si no podés usarla, cerralo y escribí el código a mano.
          </p>
        )}

        <div className="flex justify-end">
          <BotonSecundario type="button" onClick={onCerrar}>
            Cerrar
          </BotonSecundario>
        </div>
      </div>
    </Modal>
  );
}
