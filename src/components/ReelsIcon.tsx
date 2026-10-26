import React from 'react';
import { SvgXml } from 'react-native-svg';

const REELS_SVG =
  `<svg width="19" height="19" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">` +
  `<path d="M18.375 5.25H14.0618L10.6868 0H13.125C16.0245 0 18.375 2.35051 18.375 5.25Z" fill="white"/>` +
  `<path d="M5.25 0H9.12654L12.5015 5.25H7.93657L4.58814 0.0413208C4.80492 0.0140512 5.02582 0 5.25 0Z" fill="white"/>` +
  `<path d="M3.25379 0.392826C1.34434 1.17842 0 3.05722 0 5.25H6.37626L3.25379 0.392826Z" fill="white"/>` +
  `<path fill-rule="evenodd" clip-rule="evenodd" d="M0 6.56207H18.375V13.1246C18.375 16.0241 16.0245 18.3746 13.125 18.3746H5.25C2.3505 18.3746 0 16.0241 0 13.1246V6.56207ZM12.2587 11.7781C12.5387 11.9391 12.5387 12.3413 12.2587 12.5023L7.84875 15.0367C7.56875 15.1976 7.21875 14.9965 7.21875 14.6746V9.60577C7.21875 9.28394 7.56875 9.08279 7.84875 9.24371L12.2587 11.7781Z" fill="white"/>` +
  `</svg>`;

interface ReelsIconProps {
  size?: number;
}

export function ReelsIcon({ size = 24 }: ReelsIconProps) {
  return (
    <SvgXml xml={REELS_SVG} width={size} height={size} />
  );
}
