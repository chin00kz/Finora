interface LogoProps {
  size?: number;
  className?: string;
  variant?: 'brand' | 'adaptive';
}

export default function Logo({ size = 24, className = '', variant = 'brand' }: LogoProps) {
  // Brand variant uses the signature navy (#203047) in light mode and vibrant sky-blue (#38BDF8) in dark mode.
  // Adaptive variant uses currentColor for the wallet body so it adapts directly to text color.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 2200 2200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Finora Logo"
    >
      {/* Back card */}
      <path
        d="M 1410.24 505.39 L 530.80 719.96 L 1287.74 333.04 C 1324.03 314.18 1368.40 334.31 1378.11 374.04 L 1410.24 505.39 Z"
        className={variant === 'brand' ? 'fill-[#3064B7] dark:fill-[#60A5FA]' : 'fill-[#3064B7] dark:fill-[#60A5FA]'}
      />
      {/* Front card */}
      <path
        d="M 1538.08 505.08 L 657.38 719.96 L 1616.13 719.96 L 1616.13 566.38 C 1616.13 525.48 1577.81 495.39 1538.08 505.08 Z"
        className={variant === 'brand' ? 'fill-[#248AEF] dark:fill-[#93C5FD]' : 'fill-[#248AEF] dark:fill-[#93C5FD]'}
      />
      {/* Wallet Body */}
      <path
        d="M 1445.32 1261.73 L 1445.32 1359.39 C 1445.32 1419.46 1494.02 1468.15 1554.09 1468.15 L 1787.72 1468.15 C 1804.62 1468.15 1818.32 1481.85 1818.32 1498.76 L 1818.32 1754.43 C 1818.32 1820.52 1764.74 1874.10 1698.65 1874.10 L 448.28 1874.10 C 382.18 1874.10 328.60 1820.52 328.60 1754.43 L 328.60 866.69 C 328.60 800.59 382.18 747.01 448.28 747.01 L 1698.65 747.01 C 1764.74 747.01 1818.32 800.59 1818.32 866.69 L 1818.32 1122.36 C 1818.32 1139.26 1804.62 1152.96 1787.72 1152.96 L 1554.09 1152.96 C 1494.02 1152.96 1445.32 1201.66 1445.32 1261.73 Z"
        className={variant === 'brand' ? 'fill-[#203047] dark:fill-[#38BDF8]' : 'fill-current'}
      />
      {/* Clasp Tab */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M 1823.24 1182.96 L 1554.50 1182.96 C 1510.77 1182.96 1475.32 1218.41 1475.32 1262.15 L 1475.32 1358.97 C 1475.32 1402.70 1510.77 1438.15 1554.50 1438.15 L 1823.24 1438.15 C 1849.84 1438.15 1871.40 1416.59 1871.40 1389.99 L 1871.40 1231.12 C 1871.40 1204.52 1849.84 1182.96 1823.24 1182.96 Z M 1594.82 1358.74 C 1568.20 1358.74 1546.63 1337.17 1546.63 1310.56 C 1546.63 1283.95 1568.20 1262.37 1594.82 1262.37 C 1621.43 1262.37 1643.00 1283.95 1643.00 1310.56 C 1643.00 1337.17 1621.43 1358.74 1594.82 1358.74 Z"
        className={variant === 'brand' ? 'fill-[#203047] dark:fill-[#38BDF8]' : 'fill-current'}
      />
      {/* Clasp center button */}
      <path
        d="M 1594.82 1358.74 C 1568.20 1358.74 1546.63 1337.17 1546.63 1310.56 C 1546.63 1283.95 1568.20 1262.37 1594.82 1262.37 C 1621.43 1262.37 1643.00 1283.95 1643.00 1310.56 C 1643.00 1337.17 1621.43 1358.74 1594.82 1358.74 Z"
        className={variant === 'brand' ? 'fill-white dark:fill-slate-900' : 'fill-background'}
      />
    </svg>
  );
}
