export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AnchorKind = 'foot' | 'center' | 'top';

export interface AnimationGroup {
  name: string;
  cells: Cell[];
  anchor?: AnchorKind;
  frameRate?: number;
}

export interface ExtractConfig {
  input: string;
  outputDir: string;
  groups: AnimationGroup[];
  defaultAnchor?: AnchorKind;
  defaultFrameRate?: number;
  bgRemoval?: {
    enabled?: boolean;
    model?: 'small' | 'medium';
  };
  alphaThreshold?: number;
  padding?: number;
}

export interface ExtractedFrame {
  groupName: string;
  index: number;
  fileName: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

export interface ExtractedGroup {
  name: string;
  frameWidth: number;
  frameHeight: number;
  frameRate: number;
  anchor: AnchorKind;
  frames: ExtractedFrame[];
}
