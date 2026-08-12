export type CaptureType = 'area' | 'visible' | 'full-page' | 'element';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportMetrics {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface PageMetrics extends ViewportMetrics {
  pageWidth: number;
  pageHeight: number;
  scrollX: number;
  scrollY: number;
}

export interface FullPageSlice {
  index: number;
  scrollX: number;
  scrollY: number;
  source: Rect;
  destination: Rect;
}

export interface CapturedSlice extends FullPageSlice {
  dataUrl: string;
}

export interface CaptureSettings {
  copyToClipboard: boolean;
  saveAutomatically: boolean;
  showConfirmation: boolean;
  keepRecent: boolean;
  maxRecent: number;
}

export interface RecentCapture {
  id: string;
  type: CaptureType;
  createdAt: number;
  width: number;
  height: number;
  bytes: number;
  filename: string;
  thumbnailDataUrl: string;
}

export type FeedbackKind = 'success' | 'warning' | 'error';

export interface FeedbackMessage {
  kind: FeedbackKind;
  message: string;
}
