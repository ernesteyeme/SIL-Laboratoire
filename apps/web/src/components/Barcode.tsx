import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  /** Hauteur des barres en pixels (à l'écran) */
  height?: number;
  /** Largeur d'un module en pixels */
  width?: number;
  showText?: boolean;
  className?: string;
}

/** Code-barres Code 128 (optimisé automatiquement en jeu C pour les numéros d'échantillon numériques). */
export function Barcode({ value, height = 40, width = 1.6, showText = true, className }: Props) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    JsBarcode(ref.current, value, {
      format: 'CODE128',
      height,
      width,
      displayValue: showText,
      fontSize: 13,
      margin: 0,
      textMargin: 1,
      font: 'monospace',
    });
  }, [value, height, width, showText]);

  return <svg ref={ref} className={className} role="img" aria-label={`Code-barres ${value}`} />;
}
