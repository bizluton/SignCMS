export type StudioAspectRatio = "16:9" | "9:16";
export type StudioIconKey = "square" | "columns2" | "rows2" | "layoutGrid" | "utensils" | "partyPopper" | "shoppingBag" | "sun" | "gift" | "coffee";

export interface StudioZoneContent {
  type: "text" | "media" | "color" | "widget";
  value: string;
  bgColor?: string;
  fontSize?: number;
  textColor?: string;
  textAlign?: "left" | "center" | "right";
  mediaItems?: unknown[];
  carouselInterval?: number;
  carouselTransition?: "fade" | "slide" | "zoom" | "none";
  widgetId?: string;
  widgetName?: string;
  widgetConfig?: unknown;
  fitMode?: "cover-x" | "cover-y" | "contain" | "stretch";
}

export interface StudioZonePreset {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  content?: StudioZoneContent;
}

export interface StudioLayoutPreset {
  id: string;
  nameKey: string;
  iconKey: StudioIconKey;
  zones: StudioZonePreset[];
  aspect: StudioAspectRatio;
}

export interface StudioTemplatePreset {
  id: string;
  nameKey: string;
  iconKey: StudioIconKey;
  color: string;
  zones: StudioZonePreset[];
  aspect: StudioAspectRatio;
}

export const STUDIO_LAYOUT_PRESETS: StudioLayoutPreset[] = [
  { id: "full", nameKey: "studioLayoutFull", aspect: "16:9", iconKey: "square", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 100, label: "A" },
  ]},
  { id: "lr-5050", nameKey: "studioLayoutLR", aspect: "16:9", iconKey: "columns2", zones: [
    { id: "z1", x: 0, y: 0, w: 50, h: 100, label: "A" },
    { id: "z2", x: 50, y: 0, w: 50, h: 100, label: "B" },
  ]},
  { id: "lr-7030", nameKey: "studioLayoutLR7030", aspect: "16:9", iconKey: "columns2", zones: [
    { id: "z1", x: 0, y: 0, w: 70, h: 100, label: "A" },
    { id: "z2", x: 70, y: 0, w: 30, h: 100, label: "B" },
  ]},
  { id: "lr-3070", nameKey: "studioLayoutLR3070", aspect: "16:9", iconKey: "columns2", zones: [
    { id: "z1", x: 0, y: 0, w: 30, h: 100, label: "A" },
    { id: "z2", x: 30, y: 0, w: 70, h: 100, label: "B" },
  ]},
  { id: "tb-7525", nameKey: "studioLayoutTB", aspect: "16:9", iconKey: "rows2", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 75, label: "A" },
    { id: "z2", x: 0, y: 75, w: 100, h: 25, label: "B" },
  ]},
  { id: "tb-5050", nameKey: "studioLayoutTB5050", aspect: "16:9", iconKey: "rows2", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 50, label: "A" },
    { id: "z2", x: 0, y: 50, w: 100, h: 50, label: "B" },
  ]},
  { id: "t-shape", nameKey: "studioLayoutTShape", aspect: "16:9", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 50, label: "A" },
    { id: "z2", x: 0, y: 50, w: 50, h: 50, label: "B" },
    { id: "z3", x: 50, y: 50, w: 50, h: 50, label: "C" },
  ]},
  { id: "t-inverse", nameKey: "studioLayoutTInverse", aspect: "16:9", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 50, h: 50, label: "A" },
    { id: "z2", x: 50, y: 0, w: 50, h: 50, label: "B" },
    { id: "z3", x: 0, y: 50, w: 100, h: 50, label: "C" },
  ]},
  { id: "main-side2", nameKey: "studioLayoutMainSide2", aspect: "16:9", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 70, h: 100, label: "A" },
    { id: "z2", x: 70, y: 0, w: 30, h: 50, label: "B" },
    { id: "z3", x: 70, y: 50, w: 30, h: 50, label: "C" },
  ]},
  { id: "grid-2x2", nameKey: "studioLayoutGrid", aspect: "16:9", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 50, h: 50, label: "A" },
    { id: "z2", x: 50, y: 0, w: 50, h: 50, label: "B" },
    { id: "z3", x: 0, y: 50, w: 50, h: 50, label: "C" },
    { id: "z4", x: 50, y: 50, w: 50, h: 50, label: "D" },
  ]},
  { id: "main-side3", nameKey: "studioLayoutMainSide3", aspect: "16:9", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 70, h: 100, label: "A" },
    { id: "z2", x: 70, y: 0, w: 30, h: 33.34, label: "B" },
    { id: "z3", x: 70, y: 33.34, w: 30, h: 33.33, label: "C" },
    { id: "z4", x: 70, y: 66.67, w: 30, h: 33.33, label: "D" },
  ]},
  { id: "two-top-bottom-bar", nameKey: "studioLayoutTwoTopBottomBar", aspect: "16:9", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 50, h: 85, label: "A" },
    { id: "z2", x: 50, y: 0, w: 50, h: 85, label: "B" },
    { id: "z3", x: 0, y: 85, w: 100, h: 15, label: "C" },
  ]},
  { id: "top-three-bottom-bar", nameKey: "studioLayoutTopThreeBottomBar", aspect: "16:9", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 33.34, h: 85, label: "A" },
    { id: "z2", x: 33.34, y: 0, w: 33.33, h: 85, label: "B" },
    { id: "z3", x: 66.67, y: 0, w: 33.33, h: 85, label: "C" },
    { id: "z4", x: 0, y: 85, w: 100, h: 15, label: "D" },
  ]},
  { id: "main-side-corner-bar", nameKey: "studioLayoutMainSideCornerBar", aspect: "16:9", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 70, h: 85, label: "A" },
    { id: "z2", x: 70, y: 0, w: 30, h: 30, label: "B" },
    { id: "z3", x: 70, y: 30, w: 30, h: 55, label: "C" },
    { id: "z4", x: 0, y: 85, w: 100, h: 15, label: "D" },
  ]},
  { id: "side-three-bottom-bar", nameKey: "studioLayoutFourTopBottomBar", aspect: "16:9", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 25, h: 85, label: "A" },
    { id: "z2", x: 25, y: 0, w: 25, h: 85, label: "B" },
    { id: "z3", x: 50, y: 0, w: 25, h: 85, label: "C" },
    { id: "z4", x: 75, y: 0, w: 25, h: 85, label: "D" },
    { id: "z5", x: 0, y: 85, w: 100, h: 15, label: "E" },
  ]},
  { id: "grid-3x2", nameKey: "studioLayoutGrid3x2", aspect: "16:9", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 33.34, h: 50, label: "A" },
    { id: "z2", x: 33.34, y: 0, w: 33.33, h: 50, label: "B" },
    { id: "z3", x: 66.67, y: 0, w: 33.33, h: 50, label: "C" },
    { id: "z4", x: 0, y: 50, w: 33.34, h: 50, label: "D" },
    { id: "z5", x: 33.34, y: 50, w: 33.33, h: 50, label: "E" },
    { id: "z6", x: 66.67, y: 50, w: 33.33, h: 50, label: "F" },
  ]},
  { id: "v-full", nameKey: "studioLayoutVFull", aspect: "9:16", iconKey: "square", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 100, label: "A" },
  ]},
  { id: "v-tb-5050", nameKey: "studioLayoutVTB5050", aspect: "9:16", iconKey: "rows2", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 50, label: "A" },
    { id: "z2", x: 0, y: 50, w: 100, h: 50, label: "B" },
  ]},
  { id: "v-main-ticker", nameKey: "studioLayoutVMainTicker", aspect: "9:16", iconKey: "rows2", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 85, label: "A" },
    { id: "z2", x: 0, y: 85, w: 100, h: 15, label: "B" },
  ]},
  { id: "v-header-main", nameKey: "studioLayoutVHeaderMain", aspect: "9:16", iconKey: "rows2", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 15, label: "A" },
    { id: "z2", x: 0, y: 15, w: 100, h: 85, label: "B" },
  ]},
  { id: "v-three", nameKey: "studioLayoutVThree", aspect: "9:16", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 15, label: "A" },
    { id: "z2", x: 0, y: 15, w: 100, h: 70, label: "B" },
    { id: "z3", x: 0, y: 85, w: 100, h: 15, label: "C" },
  ]},
  { id: "v-main-bottom2", nameKey: "studioLayoutVMainBottom2", aspect: "9:16", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 70, label: "A" },
    { id: "z2", x: 0, y: 70, w: 50, h: 30, label: "B" },
    { id: "z3", x: 50, y: 70, w: 50, h: 30, label: "C" },
  ]},
  { id: "v-four", nameKey: "studioLayoutVFour", aspect: "9:16", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 25, label: "A" },
    { id: "z2", x: 0, y: 25, w: 100, h: 25, label: "B" },
    { id: "z3", x: 0, y: 50, w: 100, h: 25, label: "C" },
    { id: "z4", x: 0, y: 75, w: 100, h: 25, label: "D" },
  ]},
  { id: "v-grid-2x3", nameKey: "studioLayoutVGrid2x3", aspect: "9:16", iconKey: "layoutGrid", zones: [
    { id: "z1", x: 0, y: 0, w: 50, h: 33.34, label: "A" },
    { id: "z2", x: 50, y: 0, w: 50, h: 33.34, label: "B" },
    { id: "z3", x: 0, y: 33.34, w: 50, h: 33.33, label: "C" },
    { id: "z4", x: 50, y: 33.34, w: 50, h: 33.33, label: "D" },
    { id: "z5", x: 0, y: 66.67, w: 50, h: 33.33, label: "E" },
    { id: "z6", x: 50, y: 66.67, w: 50, h: 33.33, label: "F" },
  ]},
];

export const STUDIO_TEMPLATE_PRESETS: StudioTemplatePreset[] = [
  { id: "t-food", nameKey: "studioTplFood", iconKey: "utensils", color: "hsl(15 80% 55%)", aspect: "16:9", zones: [
    { id: "z1", x: 0, y: 0, w: 60, h: 100, label: "A", content: { type: "color", value: "", bgColor: "hsl(15 80% 55%)" } },
    { id: "z2", x: 60, y: 0, w: 40, h: 60, label: "B", content: { type: "text", value: "🍕 今日特餐 50% OFF", fontSize: 28, textColor: "hsl(0 0% 100%)", bgColor: "hsl(15 70% 45%)" } },
    { id: "z3", x: 60, y: 60, w: 40, h: 40, label: "C", content: { type: "text", value: "限時優惠", fontSize: 20, textColor: "hsl(0 0% 100%)", bgColor: "hsl(15 60% 35%)" } },
  ]},
  { id: "t-holiday", nameKey: "studioTplHoliday", iconKey: "partyPopper", color: "hsl(340 75% 55%)", aspect: "16:9", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 70, label: "A", content: { type: "text", value: "🎉 新年快樂！", fontSize: 48, textColor: "hsl(45 100% 60%)", bgColor: "hsl(340 75% 50%)" } },
    { id: "z2", x: 0, y: 70, w: 100, h: 30, label: "B", content: { type: "text", value: "全館消費滿千送百 🧧", fontSize: 22, textColor: "hsl(0 0% 100%)", bgColor: "hsl(340 65% 40%)" } },
  ]},
  { id: "t-newproduct", nameKey: "studioTplNew", iconKey: "shoppingBag", color: "hsl(210 80% 55%)", aspect: "9:16", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 55, label: "A", content: { type: "color", value: "", bgColor: "hsl(210 80% 55%)" } },
    { id: "z2", x: 0, y: 55, w: 100, h: 25, label: "B", content: { type: "text", value: "✨ 新品上市", fontSize: 36, textColor: "hsl(0 0% 100%)", bgColor: "hsl(210 70% 45%)" } },
    { id: "z3", x: 0, y: 80, w: 100, h: 20, label: "C", content: { type: "text", value: "即日起限量發售", fontSize: 18, textColor: "hsl(210 20% 90%)", bgColor: "hsl(210 60% 35%)" } },
  ]},
  { id: "t-summer", nameKey: "studioTplSummer", iconKey: "sun", color: "hsl(38 90% 55%)", aspect: "16:9", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 100, label: "A", content: { type: "text", value: "☀️ 夏日祭典\n冰品買一送一", fontSize: 40, textColor: "hsl(0 0% 100%)", bgColor: "hsl(38 85% 50%)" } },
  ]},
  { id: "t-gift", nameKey: "studioTplGift", iconKey: "gift", color: "hsl(280 60% 55%)", aspect: "16:9", zones: [
    { id: "z1", x: 0, y: 0, w: 50, h: 100, label: "A", content: { type: "color", value: "", bgColor: "hsl(280 60% 50%)" } },
    { id: "z2", x: 50, y: 0, w: 50, h: 100, label: "B", content: { type: "text", value: "🎁 禮品卡\n滿額贈送", fontSize: 32, textColor: "hsl(0 0% 100%)", bgColor: "hsl(280 50% 40%)" } },
  ]},
  { id: "t-coffee", nameKey: "studioTplCoffee", iconKey: "coffee", color: "hsl(25 60% 40%)", aspect: "9:16", zones: [
    { id: "z1", x: 0, y: 0, w: 100, h: 40, label: "A", content: { type: "text", value: "☕", fontSize: 72, textColor: "hsl(25 30% 90%)", bgColor: "hsl(25 50% 30%)" } },
    { id: "z2", x: 0, y: 40, w: 100, h: 35, label: "B", content: { type: "text", value: "手沖咖啡\n第二杯半價", fontSize: 28, textColor: "hsl(0 0% 100%)", bgColor: "hsl(25 55% 35%)" } },
    { id: "z3", x: 0, y: 75, w: 100, h: 25, label: "C", content: { type: "text", value: "每日 14:00-17:00", fontSize: 18, textColor: "hsl(25 20% 80%)", bgColor: "hsl(25 40% 25%)" } },
  ]},
];
