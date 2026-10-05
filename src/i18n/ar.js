// i18n/ar.js — all Arabic UI strings + filename/date helpers (Track E).
//
// The ONE import: model/scope.js owns what "scoped" means (isScoped/normalizeScope), and
// buildFileName's suffix must agree with the deck's cover line and header tag, which
// build-spec reads from the very same predicate. A local re-derivation here is exactly
// how a filename would one day say «مخصص» while the cover says nothing (or the reverse).
// scope.js is pure (no DOM, no vendor, no ar.js back-edge), so this adds no cycle.
import { isScoped, normalizeScope } from '../model/scope.js?v=v2026-10-05.2';

/** Join ids for a sentence: Arabic comma, tolerant of a bare string or a missing list. */
const joinIds = (ids) => [].concat(ids == null ? [] : ids).map(String).join('، ');

/** All UI strings, grouped by screen/area. */
export const STR = {
  appTitle: 'مولد تقرير مسبار الأسبوعي',
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
    // The OPTIONAL filtered-CSV download (ui/csv-export-section.js, rules in
    // model/csv-filter.js). It hands the user back THEIR OWN uploaded rows — every
    // column, patient name / national id / MRN included — so `privacy` sits beside the
    // button and must keep saying so. `stage` labels are the csv-filter.js stage keys:
    // each order line is in exactly ONE (hint says why: the LAST milestone date it
    // reached; cancelled / rejected by status). The five ladder stages are sequential,
    // which contiguityHint explains — it is ALSO the title of a ladder chip the section
    // disables, the reason a chip cannot be ticked. noRaw replaces the whole selection
    // when the orders did not come from a CSV upload (live pull / snapshot: no patient
    // columns, nothing to hand back). `failed` and `stale` are section-only toasts:
    // stale = the order data changed under an open card, so it rebuilt and the operator
    // must re-check the (reset) choice before the file can be downloaded.
    csvExport: {
      title: 'تنزيل ملف الطلبات مُصفّى (CSV)',
      hint: 'اختياري — نزّل سطور ملفك الأصلي لمختبرات ومراحل تختارها. كل طلب في مرحلة واحدة: آخر تاريخ وصل إليه.',
      labs: 'المختبرات',
      allLabs: 'كل المختبرات',
      stages: 'مرحلة الطلب',
      allStages: 'كل المراحل',
      stage: {
        notCollected: 'لم تُسحب العينة بعد',
        notShipped: 'لم تُشحن بعد',
        notReceived: 'لم تُستلم بعد',
        notResulted: 'لم تصدر النتيجة بعد',
        resulted: 'صدرت النتيجة',
        rejected: 'مرفوضة',
        cancelled: 'ملغاة',
      },
      contiguityHint: 'المراحل متتالية: اختر مراحل متجاورة فقط، فلا تُترك مرحلة بين مرحلتين مختارتين. «مرفوضة» و«ملغاة» مستقلتان.',
      count: (n) => `عدد السطور المطابقة: ${n}`,
      download: '⬇ تنزيل الملف المُصفّى',
      noRaw: 'هذه الأداة تعمل مع ملف CSV مرفوع فقط — السحب المباشر من Grafana ولقطة البيانات لا يحملان أعمدة بيانات المرضى.',
      privacy: 'الملف يحتوي على بيانات المرضى (الاسم والهوية والرقم الطبي) — تعامل معه بسرية ولا تشاركه إلا مع المعنيين.',
      failed: 'تعذّر إنشاء الملف المُصفّى.',
      stale: 'تغيّرت بيانات الطلبات فأُعيد ضبط الاختيار — راجعه ثم نزّل الملف.',
    },
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
    // Send-out attribution disclosure (ui/screen-review.js: the amber gaps card and the
    // informational by-test-name card). Each hint says EXACTLY what model/sendout.js puts
    // in its bucket — change the two together:
    //   unmapped   — the performing lab is blank (and the shared inference could not fill
    //                it from the test's other orders), OR the lab is no KNOWN supplier (no
    //                alias reaching one, and its own name is not a supplier's) AND its test
    //                name does not pin exactly one supplier+country+reference lab: absent
    //                from the file, or listed with several;
    //   unresolved — the supplier IS known and contracted in several countries, but this
    //                test name is not among its listed tests (matched as written, only
    //                case/whitespace folded — no prefix or dash tolerance);
    //   byTestName — NOT a gap: the lab is no known supplier, so the order was placed by
    //                a test name listed under exactly one supplier. On the slides.
    // WHY THE REWRITE (2026-09-29): the old single hint said the lab "has no matching
    // supplier in the master file" — in the Genalive case the supplier WAS in the file,
    // only the lab↔supplier link was missing — and the first rewrite still told the
    // reviewer to "check the spelling" of both names. An unmapped order's names may be
    // spelled perfectly (a blank lab; a test listed under two suppliers), so no hint may
    // send the reviewer to correct something that is already right.
    // noLab/orders: the gaps card's caption for a blank-lab group and its per-group count.
    sendout: {
      gapsTitle: 'طلبات لم تُنسب إلى دولة',
      unmappedHint: 'لم تُنسب هذه الطلبات إلى دولة: إمّا أن المختبر المُنفِّذ فارغ في الطلب ولم يمكن استنتاجه من طلبات الفحص نفسه، وإمّا أن اسم المختبر لا يقابله مورد معروف في ملف الموردين واسم الفحص ليس مُدرجًا تحت مورد واحد فقط — فهو غير مُدرج في الملف، أو مُدرج بأكثر من مورد أو دولة أو مختبر مرجعي. لا تظهر هذه الطلبات في شريحتَي محلي/دولي، ولن تُنسب إلى دولة بالتخمين.',
      unresolvedHint: 'المورد معروف ومتعاقد معه في أكثر من دولة، لكن اسم هذا الفحص ليس ضمن فحوصاته المُدرجة في ملف الموردين (يُطابَق الاسم كما هو، دون اعتبار لحالة الأحرف والمسافات)، فتعذّر تحديد الدولة. لا تظهر هذه الطلبات في شريحتَي محلي/دولي، ولا تُنسب إلى مورد آخر.',
      byTestNameTitle: 'طلبات نُسبت حسب اسم الفحص',
      byTestNameHint: 'للاطلاع: اسم المختبر في هذه الطلبات لا يقابله مورد معروف في ملف الموردين، فنُسب كل طلب إلى دولة حسب اسم الفحص لأنه مُدرج تحت مورد واحد فقط. تظهر هذه الطلبات في شريحتَي محلي/دولي باسم المختبر نفسه.',
      noLab: 'بدون مختبر مُنفِّذ',
      orders: (n) => `${n} طلبًا`,
    },
    // Report SCOPE (review screen) — narrows the ORDER ROWS before any number is
    // computed. A scoped deck is a SIDE REPORT: it never writes the published history
    // or the task log (automation/pipeline.js recordRunSnapshot), and it announces
    // itself on the cover, on every slide header and in the file name — `active` is the
    // same word as buildFileName's «(مخصص)» suffix so all three read alike. Never
    // persisted: the scope lives on the run, not in settings.
    scope: {
      title: 'نطاق التقرير',
      allLabs: 'كل المختبرات',
      labs: 'المختبرات',
      shipments: 'الشحنات',
      shipmentsHint: 'اختياري — رقم شحنة أو أكثر، تفصل بينها فاصلة أو مسافة أو سطر جديد.',
      shipmentsPlaceholder: 'مثال: ELAB626016، ELAB626017',
      shipmentsApply: 'تطبيق الشحنات',
      shipmentSlide: 'شريحة تفاصيل الشحنات',
      range: 'الفترة (حسب تاريخ الطلب)',
      from: 'من',
      to: 'إلى',
      rangeApply: 'تطبيق الفترة',
      rangeInvalid: 'حدّد تاريخَي البداية والنهاية معًا، على ألّا يكون تاريخ البداية بعد النهاية.',
      rangeFuture: 'تاريخ النهاية لا يمكن أن يكون بعد اليوم.',
      reset: 'العودة للتقرير الكامل',
      active: 'تقرير مخصص',
      sideReport: 'هذا تقرير جانبي مخصص: لا يُسجَّل في سجل التقارير، ولا يؤثر على مقارنات التقرير الكامل ولا على متابعة المهام.',
      notFoundTitle: 'شحنات غير موجودة في البيانات',
      notFoundBody: (ids) => `لم نجد هذه الشحنات في بيانات الطلبات الحالية: ${joinIds(ids)}. هل تتابع بدونها أم تراجع الأرقام؟`,
      proceed: 'المتابعة بدونها',
      recheck: 'مراجعة الأرقام',
      noneFound: 'لم يُعثر على أيٍّ من أرقام الشحنات المُدخلة في البيانات.',
      outsideScope: (ids) => `هذه الشحنات موجودة في البيانات لكن لا طلبات لها ضمن النطاق المحدد (المختبر/الفترة)، فلن تظهر في التقرير: ${joinIds(ids)}`,
      // Shown IN PLACE of the history panel under a scope: that panel charts the
      // published FULL reports, and one lab's (or one week's) figures beside them would
      // read as one series.
      historyHidden: 'أرقام التقارير المنشورة تخص التقرير الكامل، لذلك لا تظهر في التقرير المخصص.',
      // Toast when a scope change drops the manual KPI overrides (screen-review
      // refreshedModel): one typed against one population means nothing for another.
      overridesCleared: 'أُلغيت التعديلات اليدوية على الأرقام لأن نطاق التقرير تغيّر.',
      // Toast when a scoped build throws (screen-review modelFor fallback): the screen
      // falls back to the FULL report, and must say so rather than look unchanged.
      failed: 'تعذّر حساب أرقام نطاق التقرير، فعُرض التقرير الكامل بدلاً منه.',
      // Toast when the order data was reloaded under an open review screen: the scope
      // was built for the old rows, so it is dropped and nothing is generated yet.
      dataChanged: 'تغيّرت بيانات الطلبات فأُلغي نطاق التقرير ولم يُولَّد شيء — راجع التقرير الكامل قبل التوليد.',
    },
    // Slide-toggle chip row (bound to reportOptions.slides.*).
    slideTogglesTitle: 'الشرائح:',
    slideToggles: {
      execFunnel: 'الملخص',
      monthly: 'الشهرية',
      compliance: 'الالتزام',
      action: 'المهام',
      challenges: 'التحديات والمخاطر',
      sendout: 'محلي/دولي',
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
    // Shown INSTEAD of downloadHint when reportOptions.autoDownloadFiles is off
    // (pipeline.js shouldAutoDownloadFiles): nothing was saved by itself, so the
    // per-file buttons below are the whole download story, not a fallback.
    downloadPickHint: 'التنزيل التلقائي مُعطَّل — اختر الملفات التي تريد تنزيلها:',
    newReport: 'تقرير جديد',
    genMissing: 'وحدات التوليد غير متوفرة بعد (قيد الإنشاء).',
    failed: 'تعذّر إنشاء الملفات',
    // Scoped run only, above the per-lab "Late & Due" section: those workbooks are the
    // labs' operational chase lists and are NEVER scoped (screen-generate says why), so
    // the operator must not read them as part of the side report. {date} = the chosen
    // report date they are evaluated at.
    lateLabsUnscoped: 'ملفات المختبرات أدناه لا يُطبَّق عليها نطاق التقرير المخصص: تشمل جميع الطلبات كما في {date}.',
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
 * A scoped report's date range, as the cover and the share card print it.
 * Only the parts that differ are repeated, so the common case stays short:
 *   same month  → '11 – 23 سبتمبر 2026'
 *   same year   → '28 أغسطس – 23 سبتمبر 2026'
 *   across years→ '28 ديسمبر 2025 – 5 يناير 2026'
 * Western digits and an en dash with spaces, like every other date in the deck. A
 * one-day range prints as that single day ('23 سبتمبر 2026') — '23 – 23' reads as a
 * typo. Either end unusable → '' (a range is both-or-neither, as in model/scope.js).
 * Order is NOT checked: the review screen rejects from > to before a scope exists.
 * @param {string} fromIso 'YYYY-MM-DD'
 * @param {string} toIso 'YYYY-MM-DD'
 * @returns {string}
 */
export function formatRangeAr(fromIso, toIso) {
  const a = parseISO(fromIso);
  const b = parseISO(toIso);
  if (!a || !b) return '';
  const tail = `${b.d} ${AR_MONTHS[b.m - 1]} ${b.y}`;
  if (a.y === b.y && a.m === b.m) {
    return a.d === b.d ? tail : `${a.d} – ${tail}`;
  }
  if (a.y === b.y) return `${a.d} ${AR_MONTHS[a.m - 1]} – ${tail}`;
  return `${a.d} ${AR_MONTHS[a.m - 1]} ${a.y} – ${tail}`;
}

/**
 * Build an output filename per the report convention.
 *
 * `scope` (optional, a model/scope.js scope) exists so a SIDE REPORT can never be
 * mistaken for the full one once it is a loose file in a chat or a mail thread:
 *   • unscoped / absent → byte-identical to the historic name (the automation and the
 *     full manual report never pass a scope, and existing file names must not move);
 *   • date range        → the date part becomes 'DDMMYYYY-DDMMYYYY' (from-to), since
 *     a single day would misstate what the deck covers;
 *   • scoped at all     → ' (مخصص)' before the extension — also for a labs- or
 *     shipments-only scope, whose date part alone looks exactly like the full report's.
 * @param {string} variantPrefix e.g. 'تقرير مسبار' | 'تقرير مسبار الداخلي'
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} ext 'pptx' | 'pdf'
 * @param {Object} [scope] model/scope.js scope (normalizeScope output)
 * @returns {string} e.g. 'تقرير مسبار 19072026.pptx',
 *   'تقرير مسبار 11092026-23092026 (مخصص).pptx'
 */
export function buildFileName(variantPrefix, dateStr, ext, scope) {
  if (!isScoped(scope)) return `${variantPrefix} ${compactDate(dateStr)}.${ext}`;
  // Read the range off the NORMALISED scope — the same view isScoped just judged — so a
  // half-valid pair can never put one date in the name of a report it did not scope.
  const n = normalizeScope(scope);
  const datePart = (n.from && n.to)
    ? `${compactDate(n.from)}-${compactDate(n.to)}`
    : compactDate(dateStr);
  return `${variantPrefix} ${datePart} (مخصص).${ext}`;
}
