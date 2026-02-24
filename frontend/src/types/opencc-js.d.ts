declare module 'opencc-js' {
  export type ConverterConfig = {
    from: 'cn' | 'tw' | 'twp' | 'hk' | 'jp' | 't';
    to: 'cn' | 'tw' | 'twp' | 'hk' | 'jp' | 't';
  };

  export function Converter(config: ConverterConfig): (input: string) => string;
}

declare module 'opencc-js/cn2t' {
  export type ConverterConfig = {
    from: 'cn' | 't';
    to: 'tw' | 'hk' | 'twp' | 'jp' | 't';
  };

  export function Converter(config: ConverterConfig): (input: string) => string;
}

declare module 'opencc-js/t2cn' {
  export type ConverterConfig = {
    from: 'tw' | 'hk' | 'twp' | 'jp' | 't';
    to: 'cn' | 't';
  };

  export function Converter(config: ConverterConfig): (input: string) => string;
}
