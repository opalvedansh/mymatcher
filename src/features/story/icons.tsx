import React from 'react';
import type { IconProps as PhosphorProps, IconWeight } from 'phosphor-react-native';
// One file per icon, so the bundle carries only these, not all 1,500.
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { TextAaIcon } from 'phosphor-react-native/src/icons/TextAa';
import { StickerIcon } from 'phosphor-react-native/src/icons/Sticker';
import { MusicNotesIcon } from 'phosphor-react-native/src/icons/MusicNotes';
import { SparkleIcon } from 'phosphor-react-native/src/icons/Sparkle';
import { ScribbleIcon } from 'phosphor-react-native/src/icons/Scribble';
import { PaintBucketIcon } from 'phosphor-react-native/src/icons/PaintBucket';
import { SpeakerHighIcon } from 'phosphor-react-native/src/icons/SpeakerHigh';
import { SpeakerSlashIcon } from 'phosphor-react-native/src/icons/SpeakerSlash';
import { DownloadSimpleIcon } from 'phosphor-react-native/src/icons/DownloadSimple';
import { ArrowUUpLeftIcon } from 'phosphor-react-native/src/icons/ArrowUUpLeft';
import { PenIcon } from 'phosphor-react-native/src/icons/Pen';
import { HighlighterIcon } from 'phosphor-react-native/src/icons/Highlighter';
import { LightbulbIcon } from 'phosphor-react-native/src/icons/Lightbulb';
import { ArrowUpRightIcon } from 'phosphor-react-native/src/icons/ArrowUpRight';
import { EraserIcon } from 'phosphor-react-native/src/icons/Eraser';
import { TrashIcon } from 'phosphor-react-native/src/icons/Trash';
import { ArrowRightIcon } from 'phosphor-react-native/src/icons/ArrowRight';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';
import { TextAlignLeftIcon } from 'phosphor-react-native/src/icons/TextAlignLeft';
import { TextAlignCenterIcon } from 'phosphor-react-native/src/icons/TextAlignCenter';
import { TextAlignRightIcon } from 'phosphor-react-native/src/icons/TextAlignRight';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { XCircleIcon } from 'phosphor-react-native/src/icons/XCircle';
import { PlayIcon } from 'phosphor-react-native/src/icons/Play';
import { PauseIcon } from 'phosphor-react-native/src/icons/Pause';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { UserIcon } from 'phosphor-react-native/src/icons/User';
import { LightningIcon } from 'phosphor-react-native/src/icons/Lightning';
import { LightningSlashIcon } from 'phosphor-react-native/src/icons/LightningSlash';
import { CameraRotateIcon } from 'phosphor-react-native/src/icons/CameraRotate';
import { ImagesIcon } from 'phosphor-react-native/src/icons/Images';
import { CameraIcon } from 'phosphor-react-native/src/icons/Camera';
import { DotsThreeIcon } from 'phosphor-react-native/src/icons/DotsThree';
import { EyeIcon } from 'phosphor-react-native/src/icons/Eye';
import { HeartIcon } from 'phosphor-react-native/src/icons/Heart';
import { PaperPlaneTiltIcon } from 'phosphor-react-native/src/icons/PaperPlaneTilt';
import { ImageBrokenIcon } from 'phosphor-react-native/src/icons/ImageBroken';
import { VideoCameraIcon } from 'phosphor-react-native/src/icons/VideoCamera';
import { sz } from '@/theme/scale';

// The story camera, editor and viewer all draw their controls from this one
// family (Phosphor, Bold), so every story screen has the same line weight,
// corner style and optical size. Filled weights are kept for glyphs whose
// meaning is a solid shape: play/pause, the Close Friends star, a liked heart.

export type StoryIconProps = { size?: number; color?: string; weight?: IconWeight };

function make(Icon: React.ComponentType<PhosphorProps>, defaultWeight: IconWeight = 'bold') {
  return function StoryIcon({ size = sz(24), color = '#FFFFFF', weight = defaultWeight }: StoryIconProps) {
    return <Icon size={size} color={color} weight={weight} />;
  };
}

export const Icon = {
  close: make(XIcon),
  text: make(TextAaIcon),
  stickers: make(StickerIcon),
  music: make(MusicNotesIcon),
  filters: make(SparkleIcon),
  draw: make(ScribbleIcon),
  background: make(PaintBucketIcon),
  soundOn: make(SpeakerHighIcon),
  soundOff: make(SpeakerSlashIcon),
  save: make(DownloadSimpleIcon),
  undo: make(ArrowUUpLeftIcon),
  pen: make(PenIcon),
  marker: make(HighlighterIcon),
  neon: make(LightbulbIcon),
  arrow: make(ArrowUpRightIcon),
  eraser: make(EraserIcon),
  trash: make(TrashIcon),
  next: make(ArrowRightIcon),
  star: make(StarIcon, 'fill'),
  alignLeft: make(TextAlignLeftIcon),
  alignCenter: make(TextAlignCenterIcon),
  alignRight: make(TextAlignRightIcon),
  search: make(MagnifyingGlassIcon),
  clear: make(XCircleIcon, 'fill'),
  play: make(PlayIcon, 'fill'),
  pause: make(PauseIcon, 'fill'),
  check: make(CheckIcon),
  person: make(UserIcon),
  flashOn: make(LightningIcon, 'fill'),
  flashOff: make(LightningSlashIcon),
  flip: make(CameraRotateIcon),
  library: make(ImagesIcon),
  camera: make(CameraIcon),
  more: make(DotsThreeIcon),
  viewers: make(EyeIcon),
  like: make(HeartIcon),
  send: make(PaperPlaneTiltIcon),
  brokenImage: make(ImageBrokenIcon),
  video: make(VideoCameraIcon),
};

export type IconName = keyof typeof Icon;
