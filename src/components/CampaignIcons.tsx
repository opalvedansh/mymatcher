import React from 'react';
import { SvgXml } from 'react-native-svg';

const getTaskSvg = (color: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="3" width="16" height="18" rx="4" stroke="${color}" stroke-width="2"/>
  <path d="M9 11L11 13L15 9" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M8 17H16" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const getHeartBubbleSvg = (color: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 4H4C2.9 4 2 4.9 2 6V15C2 16.1 2.9 17 4 17H9L12 21L15 17H20C21.1 17 22 16.1 22 15V6C22 4.9 21.1 4 20 4Z" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12 12.5L11 11.5C8.5 9.2 7 7.8 7 6C7 4.3 8.3 3 10 3C11 3 11.9 3.5 12 4.3C12.1 3.5 13 3 14 3C15.7 3 17 4.3 17 6C17 7.8 15.5 9.2 13 11.5L12 12.5Z" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const getUsersSvg = (color: string) => {
  const isWhite = color.toLowerCase() === '#fff' || color.toLowerCase() === 'white' || color.toLowerCase() === '#ffffff';
  const secondaryColor = isWhite ? 'rgba(255,255,255,0.6)' : '#999999';
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="7" r="3.5" fill="${secondaryColor}"/>
  <path d="M13 19V17C13 15.3431 14.3431 14 16 14H20C21.6569 14 23 15.3431 23 17V19" fill="${secondaryColor}"/>
  <circle cx="9" cy="9" r="4.5" fill="${color}"/>
  <path d="M3 21V18.5C3 16.567 4.567 15 6.5 15H11.5C13.433 15 15 16.567 15 18.5V21" fill="${color}"/>
</svg>`;
};

const getCashSvg = (color: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="6" width="20" height="12" rx="3" stroke="${color}" stroke-width="2"/>
  <circle cx="12" cy="12" r="3" stroke="${color}" stroke-width="2"/>
</svg>`;

const getEventSvg = (color: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="4" width="18" height="18" rx="4" stroke="${color}" stroke-width="2"/>
  <path d="M3 10H21" stroke="${color}" stroke-width="2"/>
  <path d="M8 2V6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
  <path d="M16 2V6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
</svg>`;

export function TaskIcon({ size = 24, color = '#333' }: { size?: number; color?: string }) {
  return <SvgXml xml={getTaskSvg(color)} width={size} height={size} />;
}

export function HeartBubbleIcon({ size = 24, color = '#333' }: { size?: number; color?: string }) {
  return <SvgXml xml={getHeartBubbleSvg(color)} width={size} height={size} />;
}

export function UsersIcon({ size = 24, color = '#333' }: { size?: number; color?: string }) {
  return <SvgXml xml={getUsersSvg(color)} width={size} height={size} />;
}

export function CashIcon({ size = 24, color = '#333' }: { size?: number; color?: string }) {
  return <SvgXml xml={getCashSvg(color)} width={size} height={size} />;
}

export function EventIcon({ size = 24, color = '#333' }: { size?: number; color?: string }) {
  return <SvgXml xml={getEventSvg(color)} width={size} height={size} />;
}
