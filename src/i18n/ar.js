// i18n/ar.js — all Arabic UI strings + filename/date helpers (Track E).

/** All UI strings, grouped by screen/area. */
export const STR = {
  appTitle: 'مولد تقرير مسبار اليومي',
  appTitleShort: 'مسبار',
  nav: {
    home: 'الرئيسية',
    settings: 'الإعدادات',
  },
  common: {
    continue: 'متابعة',
    back: 'رجوع',
    cancel: 'إلغاء',
    add: 'أضف',
    remove: 'حذف',
    save: 'حفظ',
    today: 'اليوم',
    loading: 'جاري التحميل…',
    underConstruction: 'قيد الإنشاء',
    error: 'خطأ',
    warning: 'تنبيه',
    none: 'لا يوجد',
    count: 'العدد',
    from: 'من',
    to: 'إلى',
  },
  storage: {
    warn: 'لم يتم العثور على مساحة تخزين دائمة — لن تُحفظ الإعدادات بعد إغلاق المتصفح.',
  },
  upload: {
    title: 'رفع الملفات',
    subtitle: 'ارفع ملف الطلبات (CSV) وملف متابعة المشروع (Excel) للبدء.',
    grafanaTitle: 'السحب المباشر من Grafana',
    grafanaFetch: 'سحب البيانات مباشرة',
    grafanaFetching: 'جاري السحب…',
    grafanaHint: 'يسحب طلبات KAMC منذ بداية السنة حتى الآن — لا حاجة لملف CSV',
    grafanaOk: 'تم سحب {n} سجلاً من Grafana بنجاح',
    grafanaFail: 'فشل السحب المباشر',
    grafanaCors: 'تعذر الاتصال بـ Grafana من هذا النطاق (CORS) — اطلب من مسؤول Grafana السماح للنطاق https://abosallom.github.io أو استخدم ملف CSV',
    grafanaSnapshotOk: 'تم تحميل لقطة البيانات ({n} سجلاً، محدثة {t})',
    snapshotFreshness: 'آخر تحديث متوفر للبيانات: {t}',
    snapshotStale: '⚠ البيانات غير محدثة (آخر تحديث {t}) — إمّا أن جهاز التصدير (الماك) مغلق، أو أن Grafana كان متعطلاً مؤقتاً (يُعاد السحب تلقائياً كل ٣٠ دقيقة من ٧ صباحاً حتى ١٠:٣٠ مساءً)',
    grafanaSnapshotName: 'Grafana (لقطة)',
    grafanaSourceName: 'Grafana (مباشر)',
    cachedTrackerName: 'المتتبع المحفوظ',
    csvZoneTitle: 'ملف الطلبات (CSV)',
    csvZoneHint: 'اسحب ملف KAMC Order details هنا، أو اضغط للاختيار',
    trackerZoneTitle: 'ملف متابعة المشروع (Excel)',
    trackerZoneHint: 'اسحب ملف Misbar Project Tracker هنا، أو اضغط للاختيار',
    pick: 'اختيار ملف',
    parsing: 'جاري التحليل…',
    csvSummaryTitle: 'ملخص ملف الطلبات',
    trackerSummaryTitle: 'ملخص ملف المتابعة',
    rowsTotal: 'إجمالي السطور',
    ordersDistinct: 'عدد الطلبات',
    cancelled: 'الملغاة',
    dateRange: 'الفترة',
    tasks: 'المهام',
    challenges: 'التحديات',
    risks: 'المخاطر',
    errorsTitle: 'أخطاء أثناء التحليل',
    unmatchedTitle: 'فحوصات بدون مدة معيارية (TAT)',
    unmatchedHint: 'هذه الفحوصات غير موجودة في جدول المدد المعيارية. أضف المدة (بالأيام) لكل منها:',
    unmatchedDays: 'المدة (أيام)',
    unmatchedSaved: 'تم الحفظ',
    proceed: 'متابعة للمراجعة',
    proceedNeedBoth: 'ارفع الملفين للمتابعة',
    running: 'جاري تشغيل المحرك…',
    loadSamples: 'تحميل عينات',
    mockLoaded: 'تم تحميل بيانات تجريبية',
    ingestMissing: 'وحدة التحليل غير متوفرة بعد (قيد الإنشاء) — سيتم استخدام بيانات تجريبية.',
    engineMissing: 'محرك الحساب غير متوفر بعد (قيد الإنشاء).',
  },
  review: {
    title: 'مراجعة وتحرير التقرير',
    subtitle: 'راجع الأرقام وحرّر النصوص، ثم انتقل للتوليد.',
    reportDate: 'تاريخ التقرير',
    variantsNote: 'سيتم توليد النسختين (الداخلية ونوبكو) معًا.',
    panelsTitle: 'نقاط الشريحة الثانية',
    panelSupport: 'الدعم المطلوب',
    panelCompleted: 'المهام المنجزة',
    panelPlanned: 'المهام المخطط لها',
    panelHint: 'نقطة واحدة في كل سطر.',
    tasksCurrentTitle: 'المهام الحالية (خارجية)',
    tasksInternalTitle: 'المهام الداخلية',
    challengesTitle: 'التحديات',
    risksTitle: 'المخاطر',
    kpiTitle: 'المؤشرات (للقراءة فقط)',
    colTask: 'المهمة',
    colStatus: 'الحالة',
    colDate: 'التاريخ',
    colOwner: 'المالك',
    colTitle: 'العنوان',
    colDesc: 'الوصف',
    colImpact: 'الأثر',
    colProbability: 'الاحتمال',
    colSolution: 'الحل',
    addRow: 'إضافة صف',
    previewTitle: 'معاينة مباشرة',
    previewMissing: 'وحدات المعاينة غير متوفرة بعد (قيد الإنشاء).',
    generate: 'توليد التقارير (4 ملفات)',
    // Slide-toggle chip row (bound to reportOptions.slides.*).
    slideTogglesTitle: 'الشرائح:',
    slideToggles: {
      execFunnel: 'الملخص',
      monthly: 'الشهرية',
      compliance: 'الالتزام',
      action: 'المهام',
    },
    // Editable KPI overrides (per-run, never saved to settings).
    kpiEditTitle: 'المؤشرات (قابلة للتحرير)',
    kpiEditHint: 'القيم محسوبة تلقائياً — عدّل أي رقم لتجاوزه في هذا التقرير فقط.',
    manualBadge: 'يدوي',
    resetOverride: 'استعادة القيمة المحسوبة',
    overrideLabels: {
      total: 'إجمالي الطلبات',
      awaitingDispatch: 'في انتظار شحن العينة',
      awaitingResults: 'في انتظار النتائج',
      completed: 'نتائج مكتملة',
      rejected: 'نتائج مرفوضة',
      lateNoResult: 'طلبات متأخرة',
      shippedNotReceived: 'شُحنت ولم تُستلم',
      'funnel.created': 'المسار: إنشاء طلب',
      'funnel.collected': 'المسار: سحب العينة',
      'funnel.dispatched': 'المسار: شحن العينة',
      'funnel.received': 'المسار: استلام العينة',
      'funnel.resulted': 'المسار: إصدار نتيجة',
      cancelledNote: 'عدد الطلبات الملغاة',
      'turnaround.actual': 'زمن الإنجاز الفعلي (يوم)',
      'turnaround.expected': 'زمن الإنجاز المتوقع (يوم)',
    },
    // Collapsible report-text labels editor (persists to reportOptions.labels).
    labelsCardTitle: 'تخصيص نصوص التقرير',
    labelsCardHint: 'اترك الحقل فارغاً لاستخدام النص الافتراضي.',
    labelsUnavailable: 'محرر النصوص غير متوفر بعد (قيد الإنشاء).',
    restoreDefault: 'استعادة الافتراضي',
    kpi: {
      total: 'إجمالي الطلبات',
      completed: 'النتائج المكتملة',
      awaitingResults: 'بانتظار النتائج',
      rejected: 'النتائج المرفوضة',
      late: 'المتأخرة بدون نتيجة',
      latePct: 'نسبة التأخر',
      turnaround: 'معدل الدوران (فعلي/متوقع)',
      days: 'يوم',
    },
    status: {
      open: 'مفتوح',
      ongoing: 'مستمر',
      late: 'متأخر',
      closed: 'مغلق',
      inProgress: 'قيد التنفيذ',
    },
  },
  generate: {
    title: 'توليد التقارير',
    subtitle: 'جاري إنشاء أربعة ملفات: عرضان تقديميان (PPTX) وملفا PDF.',
    keepOpen: 'أبقِ هذه الصفحة ظاهرة في المقدمة حتى اكتمال التوليد — تصغير النافذة أو تبديل التبويب يبطئ العملية كثيراً.',
    downloadAll: 'تنزيل جميع الملفات (4)',
    preparing: 'جاري التحضير…',
    buildingSpec: 'بناء محتوى الشرائح…',
    renderingSlides: 'رسم الشرائح…',
    capturing: 'التقاط الشريحة',
    buildingPptx: 'إنشاء ملف PowerPoint…',
    buildingPdf: 'إنشاء ملف PDF…',
    fileInternalPptx: 'العرض الداخلي (PPTX)',
    fileNupcoPptx: 'عرض نوبكو (PPTX)',
    fileInternalPdf: 'التقرير الداخلي (PDF)',
    fileNupcoPdf: 'تقرير نوبكو (PDF)',
    done: 'تم إنشاء جميع الملفات',
    downloadAgain: 'تنزيل الملف',
    downloadHint: 'إن لم يبدأ التنزيل تلقائيًا، استخدم الأزرار التالية:',
    newReport: 'تقرير جديد',
    genMissing: 'وحدات التوليد غير متوفرة بعد (قيد الإنشاء).',
    failed: 'تعذّر إنشاء الملفات',
  },
  router: {
    missingScreen: 'هذه الشاشة قيد الإنشاء.',
  },
};

/** localStorage/display digits stay Western (matches the sample deck filenames). */
const pad2 = (n) => String(n).padStart(2, '0');

/** Split a 'YYYY-MM-DD' (or Date) into {y,m,d} numbers. */
function parseISO(dateStr) {
  if (dateStr instanceof Date) {
    return { y: dateStr.getFullYear(), m: dateStr.getMonth() + 1, d: dateStr.getDate() };
  }
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** Today's date as 'YYYY-MM-DD' (local). */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' for display. Returns '' on bad input. */
export function formatDateAr(dateStr) {
  const p = parseISO(dateStr);
  if (!p) return '';
  return `${pad2(p.d)}/${pad2(p.m)}/${p.y}`;
}

/** 'YYYY-MM-DD' -> 'DDMMYYYY' (compact, no separators). */
export function compactDate(dateStr) {
  const p = parseISO(dateStr);
  if (!p) return '';
  return `${pad2(p.d)}${pad2(p.m)}${p.y}`;
}

/** Arabic month names for optional long-form labels. */
export const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** 'YYYY-MM-DD' -> 'DD شهر YYYY'. */
export function formatDateLongAr(dateStr) {
  const p = parseISO(dateStr);
  if (!p) return '';
  return `${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}`;
}

/**
 * Build an output filename per the report convention.
 * @param {string} variantPrefix e.g. 'تقرير مسبار' | 'تقرير مسبار الداخلي'
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} ext 'pptx' | 'pdf'
 * @returns {string} e.g. 'تقرير مسبار 19072026.pptx'
 */
export function buildFileName(variantPrefix, dateStr, ext) {
  return `${variantPrefix} ${compactDate(dateStr)}.${ext}`;
}
