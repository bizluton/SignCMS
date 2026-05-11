import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useUserOrgs } from "@/hooks/useUserOrgs";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { uploadMediaFile } from "@/lib/uploadMedia";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { VideoThumb } from "@/components/media/VideoThumb";
import { MediaHoverPreview, type MediaHoverPreviewData } from "@/components/media/MediaHoverPreview";
import {
  formatBytesCompact,
  formatDimensions,
  formatDuration as formatMediaDuration,
  getDurationSec as getMediaDurationSec,
  getSizeBytes as getMediaSizeBytes,
} from "@/lib/mediaFormat";
import {
  Monitor, Smartphone, LayoutGrid, Columns2, Rows2, Square,
  Type, ImageIcon, Film, Palette, Upload, Trash2, ChevronRight,
  Utensils, PartyPopper, ShoppingBag, Sun, Gift, Coffee,
  X, Plus, AlignLeft, AlignCenter, AlignRight, Minus,
  Save, FolderOpen, FilePlus, ChevronLeft, ChevronRightIcon, Play, Pause,
  Layers, Code2, Clock, Calendar, Globe, CloudSun, QrCode, Timer, Youtube, Move, Maximize2, Lock, Unlock, Check,
  Search, ArrowUpDown, ArrowDownAZ, ArrowUpAZ, GripVertical, MoreHorizontal, PanelLeft, PanelRight, Edit3, Eye, EyeOff, List, ChevronUp, ChevronDown,
  Music, Volume2, Settings2, VolumeX,
  Download, Loader2, Radio, Megaphone, Rocket,
  SlidersHorizontal, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { QRCodeSVG } from "qrcode.react";
import Hls from "hls.js";
import { useWidgets, widgetsToStudioRows } from "@/hooks/useWidgets";
import { useInstalledApps } from "@/contexts/InstalledAppsContext";
import { WidgetPreviewCard } from "@/components/widgets/WidgetPreviewCard";
import QueueDisplayWidget from "@/components/widgets/QueueDisplayWidget";
import MeetingRoomWidget from "@/components/widgets/MeetingRoomWidget";
import { StudioPreviewDialog } from "@/components/studio/StudioPreviewDialog";
import { QuickPublishDialog } from "@/components/studio/QuickPublishDialog";
import {
  STUDIO_DATA_VERSION,
  getStudioSourceCacheStatus,
  getStudioSourceStatRows,
  getStudioLayouts,
  getStudioTemplates,
  invalidateStudioSourceCache,
  saveUserScene,
  deleteUserScene,
  renameUserScene,
  type StudioIconKey,
} from "@/lib/studioData";
import { type TranslationKey } from "@/contexts/translations";
import JSZip from "jszip";
import { useProfiles } from "@/contexts/ProfilesContext";
import { Users, User as UserIcon, Building2 } from "lucide-react";
import {
  checkDesignProjectReferences,
  unassignProjectReference,
  queueDesignProjectDelete,
  cancelDesignProjectDelete,
  fetchPendingDeleteRequests,
  type ReferenceItem,
} from "@/lib/referenceCheck";