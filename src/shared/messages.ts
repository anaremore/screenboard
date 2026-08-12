import type {
  CapturedSlice,
  CaptureSettings,
  CaptureType,
  FeedbackMessage,
  PageMetrics,
  RecentCapture,
  Rect,
  ViewportMetrics,
} from './types';

export interface ProcessSingleRequest {
  operation: 'process-single';
  captureType: Exclude<CaptureType, 'full-page'>;
  dataUrl: string;
  viewport: ViewportMetrics;
  rect?: Rect;
  settings: CaptureSettings;
}

export interface ProcessFullPageRequest {
  operation: 'process-full-page';
  captureType: 'full-page';
  metrics: PageMetrics;
  slices: CapturedSlice[];
  settings: CaptureSettings;
}

export type OffscreenRequest =
  | ProcessSingleRequest
  | ProcessFullPageRequest
  | { operation: 'list-recents' }
  | { operation: 'export-recent'; id: string }
  | { operation: 'delete-recent'; id: string }
  | { operation: 'clear-recents' };

export interface ProcessResult {
  ok: true;
  id: string;
  width: number;
  height: number;
  filename: string;
  clipboard: { attempted: boolean; ok: boolean; error?: string };
}

export interface OffscreenEnvelope {
  target: 'offscreen';
  requestId: string;
  request: OffscreenRequest;
}

export type OffscreenResponse =
  | ProcessResult
  | { ok: true; captures: RecentCapture[] }
  | { ok: true; dataUrl: string; filename: string }
  | { ok: true }
  | { ok: false; error: string };

export type CaptureRequestMessage = {
  type: 'CAPTURE_REQUEST';
  mode: CaptureType;
  tabId?: number;
};

export type ContentMessage =
  | { type: 'START_SELECTION'; mode: 'area' | 'element' }
  | { type: 'HIDE_SCREENBOARD_UI' }
  | { type: 'COPY_IMAGE'; dataUrl: string }
  | ({ type: 'SHOW_FEEDBACK' } & FeedbackMessage)
  | { type: 'SELECTION_COMMIT'; mode: 'area' | 'element'; rect: Rect; viewport: ViewportMetrics }
  | { type: 'SELECTION_CANCELLED' }
  | { type: 'GET_PAGE_METRICS' }
  | { type: 'PREPARE_FULL_PAGE' }
  | { type: 'SCROLL_FULL_PAGE'; x: number; y: number; hideFixed: boolean }
  | { type: 'RESTORE_FULL_PAGE' };

export type PopupRequest =
  | CaptureRequestMessage
  | { type: 'LIST_RECENTS' }
  | { type: 'COPY_RECENT'; id: string }
  | { type: 'SAVE_RECENT'; id: string }
  | { type: 'DELETE_RECENT'; id: string }
  | { type: 'CLEAR_RECENTS' };
