// Robust translation engine for Android strings with offline glossary, format token protection, and machine translation
import { ResourceItem, SingleStringItem, PluralStringItem, ArrayStringItem } from '../types';
import { normalizePluralsForLanguage } from './xmlParser';

// Comprehensive Android UI terminology glossary for instant offline translations
export const ANDROID_LOCALIZATION_DICTIONARY: Record<string, Record<string, string>> = {
  Watched: {
    ar: 'تمت المشاهدة',
    es: 'Visto',
    fr: 'Vu',
    de: 'Gesehen',
    'pt-rBR': 'Assistido',
    ja: '視聴済み',
    'zh-rCN': '已观看',
    it: 'Visto',
    ru: 'Просмотрено',
    tr: 'İzlendi',
    hi: 'देखा गया',
  },
  Save: {
    ar: 'حفظ',
    es: 'Guardar',
    fr: 'Enregistrer',
    de: 'Speichern',
    'pt-rBR': 'Salvar',
    ja: '保存',
    'zh-rCN': '保存',
    it: 'Salva',
    ru: 'Сохранить',
    tr: 'Kaydet',
    hi: 'सहेजें',
  },
  'Save Changes': {
    ar: 'حفظ التغييرات',
    es: 'Guardar cambios',
    fr: 'Enregistrer les modifications',
    de: 'Änderungen speichern',
    'pt-rBR': 'Salvar alterações',
    ja: '変更を保存',
    'zh-rCN': '保存更改',
    it: 'Salva modifiche',
    ru: 'Сохранить изменения',
    tr: 'Değişiklikleri Kaydet',
    hi: 'परिवर्तन सहेजें',
  },
  Cancel: {
    ar: 'إلغاء',
    es: 'Cancelar',
    fr: 'Annuler',
    de: 'Abbrechen',
    'pt-rBR': 'Cancelar',
    ja: 'キャンセル',
    'zh-rCN': '取消',
    it: 'Annulla',
    ru: 'Отмена',
    tr: 'İptal',
    hi: 'रद्द करें',
  },
  'Delete Item': {
    ar: 'حذف العنصر',
    es: 'Eliminar elemento',
    fr: 'Supprimer l’élément',
    de: 'Element löschen',
    'pt-rBR': 'Excluir item',
    ja: '項目を削除',
    'zh-rCN': '删除项目',
    it: 'Elimina elemento',
    ru: 'Удалить элемент',
    tr: 'Öğeyi Sil',
    hi: 'आइटम हटाएं',
  },
  Delete: {
    ar: 'حذف',
    es: 'Eliminar',
    fr: 'Supprimer',
    de: 'Löschen',
    'pt-rBR': 'Excluir',
    ja: '削除',
    'zh-rCN': '删除',
    it: 'Elimina',
    ru: 'Удалить',
    tr: 'Sil',
    hi: 'हटाएं',
  },
  'Retry Connection': {
    ar: 'إعادة المحاولة',
    es: 'Reintentar conexión',
    fr: 'Réessayer la connexion',
    de: 'Verbindung wiederholen',
    'pt-rBR': 'Tentar conexão novamente',
    ja: '接続を再試行',
    'zh-rCN': '重试连接',
    it: 'Riprova connessione',
    ru: 'Повторить подключение',
    tr: 'Bağlantıyı Yeniden Dene',
    hi: 'पुनः प्रयास करें',
  },
  Retry: {
    ar: 'إعادة المحاولة',
    es: 'Reintentar',
    fr: 'Réessayer',
    de: 'Wiederholen',
    'pt-rBR': 'Tentar novamente',
    ja: '再試行',
    'zh-rCN': '重试',
    it: 'Riprova',
    ru: 'Повторить',
    tr: 'Yeniden Dene',
    hi: 'पुनः प्रयास',
  },
  'Welcome to OmniTask!': {
    ar: 'مرحبًا بك في OmniTask!',
    es: '¡Bienvenido a OmniTask!',
    fr: 'Bienvenue sur OmniTask !',
    de: 'Willkommen bei OmniTask!',
    'pt-rBR': 'Bem-vindo ao OmniTask!',
    ja: 'OmniTaskへようこそ！',
    'zh-rCN': '欢迎使用 OmniTask！',
    it: 'Benvenuto su OmniTask!',
    ru: 'Добро пожаловать в OmniTask!',
    tr: 'OmniTask’e Hoş Geldiniz!',
    hi: 'OmniTask में आपका स्वागत है!',
  },
  "Don't worry about losing your progress. Everything is saved automatically and works 100% offline.": {
    ar: 'لا تقلق بشأن فقدان تقدمك. يتم حفظ كل شيء تلقائيًا ويعمل دون اتصال بالإنترنت بنسبة 100%.',
    es: 'No te preocupes por perder tu progreso. Todo se guarda automáticamente y funciona 100% sin conexión.',
    fr: 'Ne vous inquiétez pas de perdre votre progression. Tout est enregistré automatiquement et fonctionne à 100 % hors ligne.',
    de: 'Keine Sorge wegen Datenverlust. Alles wird automatisch gespeichert und funktioniert zu 100% offline.',
    'pt-rBR': 'Não se preocupe em perder seu progresso. Tudo é salvo automaticamente e funciona 100% offline.',
    ja: '進行状況が失われる心配はありません。すべて自動的に保存され、100%オフラインで動作します。',
    'zh-rCN': '不必担心丢失进度。所有内容都会自动保存，并支持100%离线使用。',
    it: 'Non preoccuparti di perdere i tuoi progressi. Tutto viene salvato automaticamente e funziona al 100% offline.',
    ru: 'Не беспокойтесь о потере данных. Все сохраняется автоматически и работает на 100% офлайн.',
  },
  'Hello, %1$s! You have %2$d pending tasks for today.': {
    ar: 'مرحبًا %1$s! لديك %2$d من المهام المعلقة لهذا اليوم.',
    es: '¡Hola, %1$s! Tienes %2$d tareas pendientes para hoy.',
    fr: 'Bonjour, %1$s ! Vous avez %2$d tâches en attente pour aujourd’hui.',
    de: 'Hallo, %1$s! Du hast heute %2$d ausstehende Aufgaben.',
    'pt-rBR': 'Olá, %1$s! Você tem %2$d tarefas pendentes para hoje.',
    ja: 'こんにちは、%1$sさん！本日保留中のタスクが %2$d 件あります。',
    'zh-rCN': '你好，%1$s！你今天有 %2$d 个待办任务。',
  },
  'Task "%s" has been created successfully.': {
    ar: 'تم إنشاء المهمة "%s" بنجاح.',
    es: 'La tarea "%s" ha sido creada con éxito.',
    fr: 'La tâche « %s » a été créée avec succès.',
    de: 'Aufgabe „%s“ wurde erfolgreich erstellt.',
    'pt-rBR': 'A tarefa "%s" foi criada com sucesso.',
    ja: 'タスク「%s」が正常に作成されました。',
    'zh-rCN': '任务“%s”已成功创建。',
  },
  'Due on %1$s at %2$s': {
    ar: 'تاريخ الاستحقاق في %1$s الساعة %2$s',
    es: 'Vence el %1$s a las %2$s',
    fr: 'Échéance le %1$s à %2$s',
    de: 'Fällig am %1$s um %2$s',
    'pt-rBR': 'Vence em %1$s às %2$s',
    ja: '期限: %1$s %2$s',
    'zh-rCN': '截止日期为 %1$s %2$s',
  },
  'No active tasks found. Tap the + button below to add your first task!': {
    ar: 'لم يتم العثور على مهام نشطة. اضغط على زر + أدناه لإضافة مهمتك الأولى!',
    es: 'No se encontraron tareas activas. ¡Toca el botón + abajo para agregar tu primera tarea!',
    fr: 'Aucune tâche active trouvée. Appuyez sur le bouton + ci-dessous pour ajouter votre première tâche !',
    de: 'Keine aktiven Aufgaben gefunden. Tippe auf das +-Symbol unten, um deine erste Aufgabe hinzuzufügen!',
    'pt-rBR': 'Nenhuma tarefa ativa encontrada. Toque no botão + abaixo para adicionar sua primeira tarefa!',
    ja: 'アクティブなタスクが見つかりません。下の + ボタンをタップして最初のタスクを追加してください！',
    'zh-rCN': '未找到活动任务。点击下方的 + 按钮添加您的第一个任务！',
  },
  'Local database is using %1$.1f MB of %2$.1f MB allocated storage.': {
    ar: 'تستخدم قاعدة البيانات المحلية %1$.1f ميغابايت من مساحة التخزين المخصصة %2$.1f ميغابايت.',
    es: 'La base de datos local está usando %1$.1f MB de %2$.1f MB de almacenamiento asignado.',
    fr: 'La base de données locale utilise %1$.1f Mo sur %2$.1f Mo de stockage alloué.',
    de: 'Die lokale Datenbank belegt %1$.1f MB von %2$.1f MB zugewiesenem Speicher.',
    'pt-rBR': 'O banco de dados local está usando %1$.1f MB de %2$.1f MB de armazenamento alocado.',
    ja: 'ローカルデータベースは割り当て容量 %2$.1f MB のうち %1$.1f MB を使用しています。',
    'zh-rCN': '本地数据库正在使用已分配存储空间 %2$.1f MB 中的 %1$.1f MB。',
  },
  'By clicking continue, you agree to our Terms of Service & Privacy Policy.': {
    ar: 'بالنقر على متابعة، فإنك توافق على شروط الخدمة وسياسة الخصوصية الخاصة بنا.',
    es: 'Al hacer clic en continuar, aceptas nuestros Términos de servicio y Política de privacidad.',
    fr: 'En cliquant sur Continuer, vous acceptez nos Conditions d’utilisation et notre Politique de confidentialité.',
    de: 'Mit dem Klick auf Weiter stimmst du unseren Nutzungsbedingungen und Datenschutzrichtlinien zu.',
    'pt-rBR': 'Ao clicar em continuar, você concorda com nossos Termos de Serviço e Política de Privacidade.',
    ja: '続行をクリックすると、利用規約およびプライバシーポリシーに同意したものとみなされます。',
    'zh-rCN': '点击继续即表示您同意我们的服务条款和隐私政策。',
  },
  Urgent: {
    ar: 'عاجل',
    es: 'Urgente',
    fr: 'Urgent',
    de: 'Dringend',
    'pt-rBR': 'Urgente',
    ja: '緊急',
    'zh-rCN': '紧急',
    it: 'Urgente',
    ru: 'Срочно',
  },
  'High Priority': {
    ar: 'أولوية عالية',
    es: 'Alta prioridad',
    fr: 'Haute priorité',
    de: 'Hohe Priorität',
    'pt-rBR': 'Prioridade alta',
    ja: '高優先度',
    'zh-rCN': '高优先级',
    it: 'Alta priorità',
    ru: 'Высокий приоритет',
  },
  Normal: {
    ar: 'عادي',
    es: 'Normal',
    fr: 'Normal',
    de: 'Normal',
    'pt-rBR': 'Normal',
    ja: '通常',
    'zh-rCN': '普通',
    it: 'Normale',
    ru: 'Обычный',
  },
  'Low Priority': {
    ar: 'أولوية منخفضة',
    es: 'Baja prioridad',
    fr: 'Basse priorité',
    de: 'Niedrige Priorität',
    'pt-rBR': 'Prioridade baixa',
    ja: '低優先度',
    'zh-rCN': '低优先级',
    it: 'Bassa priorità',
    ru: 'Низкий приоритет',
  },
  Settings: {
    ar: 'الإعدادات',
    es: 'Ajustes',
    fr: 'Paramètres',
    de: 'Einstellungen',
    'pt-rBR': 'Configurações',
    ja: '設定',
    'zh-rCN': '设置',
    it: 'Impostazioni',
    ru: 'Настройки',
  },
  Search: {
    ar: 'بحث',
    es: 'Buscar',
    fr: 'Rechercher',
    de: 'Suchen',
    'pt-rBR': 'Pesquisar',
    ja: '検索',
    'zh-rCN': '搜索',
    it: 'Cerca',
    ru: 'Поиск',
  },
  Close: {
    ar: 'إغلاق',
    es: 'Cerrar',
    fr: 'Fermer',
    de: 'Schließen',
    'pt-rBR': 'Fechar',
    ja: '閉じる',
    'zh-rCN': '关闭',
    it: 'Chiudi',
    ru: 'Закрыть',
  },
  Install: {
    ar: 'تثبيت',
    es: 'Instalar',
    fr: 'Installer',
    de: 'Installieren',
    'pt-rBR': 'Instalar',
    ja: 'インストール',
    'zh-rCN': '安装',
    it: 'Installa',
    ru: 'Установить',
    tr: 'Yükle',
    hi: 'इंस्टॉल करें',
  },
  Uninstall: {
    ar: 'إلغاء التثبيت',
    es: 'Desinstalar',
    fr: 'Désinstaller',
    de: 'Deinstallieren',
    'pt-rBR': 'Desinstalar',
    ja: 'アンインストール',
    'zh-rCN': '卸载',
    it: 'Disinstalla',
    ru: 'Удалить',
    tr: 'Kaldır',
    hi: 'अनइंस्टॉल करें',
  },
  Update: {
    ar: 'تحديث',
    es: 'Actualizar',
    fr: 'Mettre à jour',
    de: 'Aktualisieren',
    'pt-rBR': 'Atualizar',
    ja: ' 업데이트',
    'zh-rCN': '更新',
    it: 'Aggiorna',
    ru: 'Обновить',
    tr: 'Güncelle',
    hi: 'अपडेट करें',
  },
  Download: {
    ar: 'تنزيل',
    es: 'Descargar',
    fr: 'Télécharger',
    de: 'Herunterladen',
    'pt-rBR': 'Baixar',
    ja: 'ダウンロード',
    'zh-rCN': '下载',
    it: 'Scarica',
    ru: 'Скачать',
    tr: 'İndir',
    hi: 'डाउनलोड करें',
  },
  Downloads: {
    ar: 'التنزيلات',
    es: 'Descargas',
    fr: 'Téléchargements',
    de: 'Downloads',
    'pt-rBR': 'Downloads',
    ja: 'ダウンロード',
    'zh-rCN': '下载内容',
    it: 'Download',
    ru: 'Загрузки',
    tr: 'İndirilenler',
  },
  Upload: {
    ar: 'رفع',
    es: 'Subir',
    fr: 'Téléverser',
    de: 'Hochladen',
    'pt-rBR': 'Enviar',
    ja: 'アップロード',
    'zh-rCN': '上传',
    it: 'Carica',
    ru: 'Загрузить',
  },
  Open: {
    ar: 'فتح',
    es: 'Abrir',
    fr: 'Ouvrir',
    de: 'Öffnen',
    'pt-rBR': 'Abrir',
    ja: '開く',
    'zh-rCN': '打开',
    it: 'Apri',
    ru: 'Открыть',
  },
  Share: {
    ar: 'مشاركة',
    es: 'Compartir',
    fr: 'Partager',
    de: 'Teilen',
    'pt-rBR': 'Compartilhar',
    ja: '共有',
    'zh-rCN': '分享',
    it: 'Condividi',
    ru: 'Поделиться',
  },
  Copy: {
    ar: 'نسخ',
    es: 'Copiar',
    fr: 'Copier',
    de: 'Kopieren',
    'pt-rBR': 'Copiar',
    ja: 'コピー',
    'zh-rCN': '复制',
    it: 'Copia',
    ru: 'Копировать',
  },
  Paste: {
    ar: 'لصق',
    es: 'Pegar',
    fr: 'Coller',
    de: 'Einfügen',
    'pt-rBR': 'Colar',
    ja: '貼り付け',
    'zh-rCN': '粘贴',
    it: 'Incolla',
    ru: 'Вставить',
  },
  Edit: {
    ar: 'تعديل',
    es: 'Editar',
    fr: 'Modifier',
    de: 'Bearbeiten',
    'pt-rBR': 'Editar',
    ja: '編集',
    'zh-rCN': '编辑',
    it: 'Modifica',
    ru: 'Изменить',
  },
  Add: {
    ar: 'إضافة',
    es: 'Añadir',
    fr: 'Ajouter',
    de: 'Hinzufügen',
    'pt-rBR': 'Adicionar',
    ja: '追加',
    'zh-rCN': '添加',
    it: 'Aggiungi',
    ru: 'Добавить',
  },
  Remove: {
    ar: 'إزالة',
    es: 'Quitar',
    fr: 'Supprimer',
    de: 'Entfernen',
    'pt-rBR': 'Remover',
    ja: '削除',
    'zh-rCN': '移除',
    it: 'Rimuovi',
    ru: 'Удалить',
  },
  Clear: {
    ar: 'مسح',
    es: 'Borrar',
    fr: 'Effacer',
    de: 'Löschen',
    'pt-rBR': 'Limpar',
    ja: 'クリア',
    'zh-rCN': '清除',
    it: 'Cancella',
    ru: 'Очистить',
  },
  Refresh: {
    ar: 'تحديث',
    es: 'Actualizar',
    fr: 'Actualiser',
    de: 'Aktualisieren',
    'pt-rBR': 'Atualizar',
    ja: '更新',
    'zh-rCN': '刷新',
    it: 'Aggiorna',
    ru: 'Обновить',
  },
  Confirm: {
    ar: 'تأكيد',
    es: 'Confirmar',
    fr: 'Confirmer',
    de: 'Bestätigen',
    'pt-rBR': 'Confirmar',
    ja: '確認',
    'zh-rCN': '确认',
    it: 'Conferma',
    ru: 'Подтвердить',
  },
  Continue: {
    ar: 'متابعة',
    es: 'Continuar',
    fr: 'Continuer',
    de: 'Weiter',
    'pt-rBR': 'Continuar',
    ja: '続行',
    'zh-rCN': '继续',
    it: 'Continua',
    ru: 'Продолжить',
  },
  Skip: {
    ar: 'تخطّي',
    es: 'Omitir',
    fr: 'Ignorer',
    de: 'Überspringen',
    'pt-rBR': 'Pular',
    ja: 'スキップ',
    'zh-rCN': '跳过',
    it: 'Salta',
    ru: 'Пропустить',
  },
  Back: {
    ar: 'رجوع',
    es: 'Atrás',
    fr: 'Retour',
    de: 'Zurück',
    'pt-rBR': 'Voltar',
    ja: '戻る',
    'zh-rCN': '返回',
    it: 'Indietro',
    ru: 'Назад',
  },
  Next: {
    ar: 'التالي',
    es: 'Siguiente',
    fr: 'Suivant',
    de: 'Weiter',
    'pt-rBR': 'Próximo',
    ja: '次へ',
    'zh-rCN': '下一步',
    it: 'Avanti',
    ru: 'Далее',
  },
  Previous: {
    ar: 'السابق',
    es: 'Anterior',
    fr: 'Précédent',
    de: 'Zurück',
    'pt-rBR': 'Anterior',
    ja: '前へ',
    'zh-rCN': '上一步',
    it: 'Precedente',
    ru: 'Назад',
  },
  Done: {
    ar: 'تم',
    es: 'Listo',
    fr: 'Terminé',
    de: 'Fertig',
    'pt-rBR': 'Concluído',
    ja: '完了',
    'zh-rCN': '完成',
    it: 'Fatto',
    ru: 'Готово',
  },
  OK: {
    ar: 'حسناً',
    es: 'Aceptar',
    fr: 'OK',
    de: 'OK',
    'pt-rBR': 'OK',
    ja: 'OK',
    'zh-rCN': '确定',
    it: 'OK',
    ru: 'ОК',
  },
  Yes: {
    ar: 'نعم',
    es: 'Sí',
    fr: 'Oui',
    de: 'Ja',
    'pt-rBR': 'Sim',
    ja: 'はい',
    'zh-rCN': '是',
    it: 'Sì',
    ru: 'Да',
  },
  No: {
    ar: 'لا',
    es: 'No',
    fr: 'Non',
    de: 'Nein',
    'pt-rBR': 'Não',
    ja: 'いいえ',
    'zh-rCN': '否',
    it: 'No',
    ru: 'Нет',
  },
  Enable: {
    ar: 'تفعيل',
    es: 'Activar',
    fr: 'Activer',
    de: 'Aktivieren',
    'pt-rBR': 'Ativar',
    ja: '有効にする',
    'zh-rCN': '启用',
    it: 'Abilita',
    ru: 'Включить',
  },
  Disable: {
    ar: 'تعطيل',
    es: 'Desactivar',
    fr: 'Désactiver',
    de: 'Deaktivieren',
    'pt-rBR': 'Desativar',
    ja: '無効にする',
    'zh-rCN': '禁用',
    it: 'Disabilita',
    ru: 'Отключить',
  },
  Play: {
    ar: 'تشغيل',
    es: 'Reproducir',
    fr: 'Lire',
    de: 'Abspielen',
    'pt-rBR': 'Reproduzir',
    ja: '再生',
    'zh-rCN': '播放',
    it: 'Riproduci',
    ru: 'Воспроизвести',
  },
  Pause: {
    ar: 'إيقاف مؤقت',
    es: 'Pausar',
    fr: 'Pause',
    de: 'Pause',
    'pt-rBR': 'Pausar',
    ja: '一時停止',
    'zh-rCN': '暂停',
    it: 'Pausa',
    ru: 'Пауза',
  },
  Stop: {
    ar: 'إيقاف',
    es: 'Detener',
    fr: 'Arrêter',
    de: 'Stopp',
    'pt-rBR': 'Parar',
    ja: '停止',
    'zh-rCN': '停止',
    it: 'Ferma',
    ru: 'Стоп',
  },
  Import: {
    ar: 'استيراد',
    es: 'Importar',
    fr: 'Importer',
    de: 'Importieren',
    'pt-rBR': 'Importar',
    ja: 'インポート',
    'zh-rCN': '导入',
    it: 'Importa',
    ru: 'Импорт',
  },
  Export: {
    ar: 'تصدير',
    es: 'Exportar',
    fr: 'Exporter',
    de: 'Exportieren',
    'pt-rBR': 'Exportar',
    ja: 'エクスポート',
    'zh-rCN': '导出',
    it: 'Esporta',
    ru: 'Экспорт',
  },
  Help: {
    ar: 'مساعدة',
    es: 'Ayuda',
    fr: 'Aide',
    de: 'Hilfe',
    'pt-rBR': 'Ajuda',
    ja: 'ヘルプ',
    'zh-rCN': '帮助',
    it: 'Aiuto',
    ru: 'Справка',
  },
  About: {
    ar: 'حول',
    es: 'Acerca de',
    fr: 'À propos',
    de: 'Über',
    'pt-rBR': 'Sobre',
    ja: '情報',
    'zh-rCN': '关于',
    it: 'Informazioni',
    ru: 'О приложении',
  },
};

// Build case-insensitive index for ANDROID_LOCALIZATION_DICTIONARY
const CASE_INSENSITIVE_GLOSSARY: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(ANDROID_LOCALIZATION_DICTIONARY).map(([k, v]) => [k.toLowerCase(), v])
);

// Arabic 6-form plural glossary for common Android plural patterns
const ARABIC_PLURAL_GLOSSARY: Record<
  string,
  Record<'zero' | 'one' | 'two' | 'few' | 'many' | 'other', string>
> = {
  'You have %d unread notification': {
    zero: 'ليس لديك أي إشعارات غير مقروءة',
    one: 'لديك إشعار واحد (%d) غير مقروء',
    two: 'لديك إشعاران (%d) غير مقروءين',
    few: 'لديك %d إشعارات غير مقروءة',
    many: 'لديك %d إشعارًا غير مقروء',
    other: 'لديك %d إشعار غير مقروء',
  },
  'You have %d unread notifications': {
    zero: 'ليس لديك أي إشعارات غير مقروءة',
    one: 'لديك إشعار واحد (%d) غير مقروء',
    two: 'لديك إشعاران (%d) غير مقروءين',
    few: 'لديك %d إشعارات غير مقروءة',
    many: 'لديك %d إشعارًا غير مقروء',
    other: 'لديك %d إشعار غير مقروء',
  },
  '%d file selected': {
    zero: 'لم يتم تحديد أي ملفات (%d)',
    one: 'تم تحديد ملف واحد (%d)',
    two: 'تم تحديد ملفين (%d)',
    few: 'تم تحديد %d ملفات',
    many: 'تم تحديد %d ملفًا',
    other: 'تم تحديد %d ملف',
  },
  '%d files selected': {
    zero: 'لم يتم تحديد أي ملفات (%d)',
    one: 'تم تحديد ملف واحد (%d)',
    two: 'تم تحديد ملفين (%d)',
    few: 'تم تحديد %d ملفات',
    many: 'تم تحديد %d ملفًا',
    other: 'تم تحديد %d ملف',
  },
};

// Helper: Decode basic HTML entities that APIs sometimes return
function decodeHtmlEntities(str: string): string {
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

// Convert Western digits to Arabic-Indic digits (for matching if an MT engine transliterates numbers)
function toArabicIndicDigits(numStr: string): string {
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return numStr.replace(/\d/g, (d) => map[Number(d)]);
}

interface ProtectedToken {
  rawToken: string; // Exact original syntax token, e.g. %1$d, \"%1$s\", @string/msg_threads
  surrogateId: string; // e.g. 987100
  surrogateText: string; // What we put into the text sent to API
  position: 'start' | 'end' | 'before_punct' | 'middle';
  trailingPunct?: string;
}

// Protect Android syntax tokens in a single line/segment before sending to API
function protectSegmentSyntax(segment: string): {
  cleanText: string;
  tokens: ProtectedToken[];
  usesEscapedDoubleQuotes: boolean;
} {
  const usesEscapedDoubleQuotes = segment.includes('\\"');
  const tokens: ProtectedToken[] = [];

  // Match:
  // 1. Escaped-quote wrapped format specifiers: \"%1$s\", \'%s\'
  // 2. Parenthesized format specifiers: (%d), (%1$s)
  // 3. Compound format specifiers like %1$d/%2$d
  // 4. Standard Android printf format specifiers: %1$s, %2$d, %s, %d, %1$.1f, %.2f, %%
  // 5. Android @string/... or @plurals/... resource references
  // 6. ICU placeholders {0}, {count} and inline HTML tags <b>, </b>, etc.
  const syntaxRegex =
    /(\\"%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]\\"|\\'%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]\\'|%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]\/%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]|%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]|@(?:string|plurals|array)\/[a-zA-Z0-9_]+|\{[a-zA-Z0-9_-]+\}|<\/?[a-zA-Z][^>]*>)/gi;

  const trimmedSeg = segment.trim();

  let cleaned = segment.replace(syntaxRegex, (match, _g1, offset) => {
    const idx = tokens.length;
    const surrogateId = `98710${idx}`;
    const isQuoted =
      (match.startsWith('\\"') && match.endsWith('\\"')) ||
      (match.startsWith("\\'") && match.endsWith("\\'"));
    const surrogateText = isQuoted ? `"${surrogateId}"` : surrogateId;

    const beforeText = segment.slice(0, offset).trim();
    const afterText = segment.slice(offset + match.length).trim();

    let position: ProtectedToken['position'] = 'middle';
    let trailingPunct: string | undefined;

    if (!beforeText) {
      position = 'start';
    } else if (!afterText) {
      position = 'end';
    } else if (/^[?.!؟،,:;)]+$/.test(afterText)) {
      position = 'before_punct';
      trailingPunct = afterText;
    }

    tokens.push({
      rawToken: match,
      surrogateId,
      surrogateText,
      position,
      trailingPunct,
    });

    return surrogateText;
  });

  // Unescape remaining \' and \" for cleaner natural-language API input (we re-apply \" if source used it)
  cleaned = cleaned.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\?/g, '?');

  // Avoid unused variable warning
  void trimmedSeg;

  return { cleanText: cleaned, tokens, usesEscapedDoubleQuotes };
}

// Restore protected syntax tokens into the translated segment and guarantee none are missing
function restoreSegmentSyntax(
  translated: string,
  tokens: ProtectedToken[],
  usesEscapedDoubleQuotes: boolean
): string {
  let result = translated;

  tokens.forEach((tk, idx) => {
    const arabicId = toArabicIndicDigits(tk.surrogateId);
    const isQuotedToken =
      (tk.rawToken.startsWith('\\"') && tk.rawToken.endsWith('\\"')) ||
      (tk.rawToken.startsWith("\\'") && tk.rawToken.endsWith("\\'"));

    if (isQuotedToken) {
      // Replace quoted surrogate variations: "987100", «987100», \"987100\", or bare 987100
      const quotedPattern = new RegExp(
        `(?:\\\\?["'«»“”]\\s*)?(?:${tk.surrogateId}|${arabicId}|\\[\\s*#\\s*${idx}\\s*#\\s*\\])(?:\\s*\\\\?["'«»“”])?`,
        'g'
      );
      result = result.replace(quotedPattern, tk.rawToken);
    } else {
      const barePattern = new RegExp(
        `(?:${tk.surrogateId}|${arabicId}|\\[\\s*#\\s*${idx}\\s*#\\s*\\])`,
        'g'
      );
      result = result.replace(barePattern, tk.rawToken);
    }

    // Guarantee: If the translation engine stripped the surrogate token, insert rawToken in its structural position
    if (!result.includes(tk.rawToken)) {
      const trimmedRes = result.trim();
      if (tk.position === 'start') {
        result = `${tk.rawToken} ${trimmedRes}`;
      } else if (tk.position === 'end') {
        result = `${trimmedRes} ${tk.rawToken}`;
      } else if (tk.position === 'before_punct') {
        const punctMatch = trimmedRes.match(/([?.!؟،,:;)]+)$/);
        if (punctMatch) {
          const base = trimmedRes.slice(0, trimmedRes.length - punctMatch[1].length).trimEnd();
          result = `${base} ${tk.rawToken}${punctMatch[1]}`;
        } else {
          result = `${trimmedRes} ${tk.rawToken}`;
        }
      } else {
        result = `${trimmedRes} ${tk.rawToken}`;
      }
    }
  });

  // If the original segment escaped double quotes (\"), ensure any unescaped double quotes in the translation are also escaped as \"
  if (usesEscapedDoubleQuotes) {
    result = result.replace(/(?<!\\)"/g, '\\"');
  }

  return result;
}

export type ProviderEngineType =
  | 'google'
  | 'yandex_builtin'
  | 'gemini'
  | 'mymemory'
  | 'yandex'
  | 'lara'
  | 'deepl'
  | 'openai'
  | 'google_cloud'
  | 'microsoft';

export interface TranslationProviderConfig {
  id: string;
  name: string;
  type: ProviderEngineType;
  apiKey?: string;
  isBuiltIn?: boolean;
  verifiedAt?: number;
}

const CUSTOM_PROVIDERS_STORAGE_KEY = 'custom_translation_providers_v1';
const ACTIVE_PROVIDER_STORAGE_KEY = 'active_translation_provider_id_v1';
const AUTO_TRANSLATE_STORAGE_KEY = 'auto_translate_untranslated_v1';

export function getAutoTranslateEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_TRANSLATE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAutoTranslateEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_TRANSLATE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.error('Failed to save auto-translate setting:', e);
  }
}

export const BUILTIN_TRANSLATION_PROVIDERS: TranslationProviderConfig[] = [
  {
    id: 'gemini',
    name: 'Gemini AI',
    type: 'gemini',
    isBuiltIn: true,
  },
  {
    id: 'google',
    name: 'Google Translate',
    type: 'google',
    isBuiltIn: true,
  },
  {
    id: 'yandex_builtin',
    name: 'Yandex AI',
    type: 'yandex_builtin',
    isBuiltIn: true,
  },
  {
    id: 'mymemory',
    name: 'MyMemory TM',
    type: 'mymemory',
    isBuiltIn: true,
  },
];

export function getCustomProviders(): TranslationProviderConfig[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PROVIDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is TranslationProviderConfig =>
        p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.type === 'string'
    );
  } catch {
    return [];
  }
}

export function saveCustomProviders(providers: TranslationProviderConfig[]): void {
  try {
    localStorage.setItem(CUSTOM_PROVIDERS_STORAGE_KEY, JSON.stringify(providers));
  } catch (e) {
    console.error('Failed to save custom providers:', e);
  }
}

export function getAllTranslationProviders(): TranslationProviderConfig[] {
  return [...BUILTIN_TRANSLATION_PROVIDERS, ...getCustomProviders()];
}

export function getActiveProviderId(): string {
  try {
    const saved = localStorage.getItem(ACTIVE_PROVIDER_STORAGE_KEY);
    const all = getAllTranslationProviders();
    if (saved && all.some((p) => p.id === saved)) {
      return saved;
    }
  } catch {
    // Ignore storage read errors
  }
  return 'gemini';
}

export function setActiveProviderId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PROVIDER_STORAGE_KEY, id);
  } catch (e) {
    console.error('Failed to save active provider ID:', e);
  }
}

export function getActiveProvider(): TranslationProviderConfig {
  const id = getActiveProviderId();
  const all = getAllTranslationProviders();
  return all.find((p) => p.id === id) || BUILTIN_TRANSLATION_PROVIDERS[0];
}

export function addCustomProvider(input: {
  name: string;
  type: ProviderEngineType;
  apiKey: string;
}): TranslationProviderConfig {
  const current = getCustomProviders();
  const newProvider: TranslationProviderConfig = {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    type: input.type,
    apiKey: input.apiKey.trim(),
    isBuiltIn: false,
    verifiedAt: Date.now(),
  };
  const updated = [...current, newProvider];
  saveCustomProviders(updated);
  setActiveProviderId(newProvider.id);
  return newProvider;
}

export function updateCustomProvider(
  id: string,
  updates: {
    name?: string;
    type?: ProviderEngineType;
    apiKey?: string;
  }
): TranslationProviderConfig | null {
  const current = getCustomProviders();
  const idx = current.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const existing = current[idx];
  const updatedProvider: TranslationProviderConfig = {
    ...existing,
    name: updates.name !== undefined ? updates.name.trim() || existing.name : existing.name,
    type: updates.type !== undefined ? updates.type : existing.type,
    apiKey: updates.apiKey !== undefined ? updates.apiKey.trim() : existing.apiKey,
    verifiedAt: Date.now(),
  };

  const updatedList = [...current];
  updatedList[idx] = updatedProvider;
  saveCustomProviders(updatedList);
  return updatedProvider;
}

export function removeCustomProvider(id: string): void {
  const current = getCustomProviders();
  const updated = current.filter((p) => p.id !== id);
  saveCustomProviders(updated);
  if (getActiveProviderId() === id) {
    setActiveProviderId('gemini');
  }
}

export interface ProviderTestResult {
  success: boolean;
  matched: boolean;
  testSource?: string;
  googleTranslation?: string;
  providerTranslation?: string;
  detectedType?: ProviderEngineType;
  error?: string;
}

export async function testProviderApiKey(
  providerType: string,
  apiKey: string
): Promise<ProviderTestResult> {
  try {
    const res = await fetch('/api/providers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerType, apiKey: apiKey.trim() }),
    });
    const data = (await res.json()) as ProviderTestResult;
    return data;
  } catch (err) {
    return {
      success: false,
      matched: false,
      error: err instanceof Error ? err.message : 'Network error while testing API key',
    };
  }
}

/**
 * Strip any metadata wrappers or labels such as "[ترجمة المصطلح: ...]" or "[Translation: ...]"
 * while preserving legitimate brackets that were part of the original source text.
 */
export function stripMetadataLabels(text: string, sourceText: string): string {
  let cleaned = text.trim();

  // Remove prefixes/wrappers like "[ترجمة المصطلح: ...]", "ترجمة المصطلح: ...", "[Translation: ...]"
  const labelPattern = /^\[?\s*(?:ترجمة المصطلح|ترجمة النص|ترجمة|Translation|Translated text)\s*[:：-]\s*(.*?)\s*\]?$/i;
  const labelMatch = cleaned.match(labelPattern);
  if (labelMatch && labelMatch[1]) {
    cleaned = labelMatch[1].trim();
  }

  // Strip accidental markdown code fences
  if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Strip outer [...] if source did not have outer [...]
  if (
    cleaned.startsWith('[') &&
    cleaned.endsWith(']') &&
    !sourceText.trim().startsWith('[') &&
    !sourceText.trim().endsWith(']')
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

/**
 * Translate a single segment (without newline separators) via glossary, the selected Translation Provider
 * (Yandex AI, Custom API Key Provider, Gemini AI, Google Translate, or MyMemory),
 * while preserving 100% of Android syntax tokens (%s, %d, %1$s, etc.).
 */
async function translateSingleSegment(
  segment: string,
  baseLang: string,
  directLang: string,
  targetLocaleName?: string,
  pluralQuantity?: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
): Promise<{ text: string; source: 'glossary' | 'mymemory' | 'heuristic' }> {
  const leadingMatch = segment.match(/^[ \t]+/);
  const trailingMatch = segment.match(/[ \t]+$/);
  const leadingSpace = leadingMatch ? leadingMatch[0] : '';
  const trailingSpace = trailingMatch ? trailingMatch[0] : '';

  const trimmed = segment.trim();
  if (!trimmed) {
    return { text: segment, source: 'glossary' };
  }

  // If the segment is purely an Android resource reference (e.g. @string/limit_data_usage_none_description)
  // or purely a format token (e.g. %1$s), return it untouched
  if (/^(@(?:string|plurals|array)\/[a-zA-Z0-9_]+|%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%])$/.test(trimmed)) {
    return { text: segment, source: 'glossary' };
  }

  // Check if entire segment is wrapped in unescaped quotes "..." (like "Loading requested content")
  const hasOuterUnescapedQuotes =
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"') &&
    !trimmed.startsWith('\\"');
  const coreText = hasOuterUnescapedQuotes ? trimmed.slice(1, -1) : trimmed;

  const wrapResult = (translatedCore: string) => {
    const withQuotes = hasOuterUnescapedQuotes
      ? `"${translatedCore.replace(/^\\?"|\\?"$/g, '')}"`
      : translatedCore;
    return `${leadingSpace}${withQuotes}${trailingSpace}`;
  };

  const activeProvider = getActiveProvider();

  // 0. Check Arabic plural 6-form glossary if pluralQuantity is provided
  if (baseLang === 'ar' && pluralQuantity && ARABIC_PLURAL_GLOSSARY[coreText]) {
    const pluralMatch = ARABIC_PLURAL_GLOSSARY[coreText][pluralQuantity];
    if (pluralMatch) {
      return { text: wrapResult(pluralMatch), source: 'glossary' };
    }
  }

  // 1. Instant check in Android UI Glossary (exact or case-insensitive) when using built-in providers
  const glossaryItem =
    ANDROID_LOCALIZATION_DICTIONARY[coreText] ||
    CASE_INSENSITIVE_GLOSSARY[coreText.toLowerCase()];
  if (glossaryItem && activeProvider.isBuiltIn) {
    const match = glossaryItem[directLang] || glossaryItem[baseLang];
    if (match) {
      return { text: wrapResult(match), source: 'glossary' };
    }
  }

  const { cleanText, tokens, usesEscapedDoubleQuotes } = protectSegmentSyntax(coreText);

  // Helper to reject polluted crowdsourced TM entries (e.g. "[ترجمة المصطلح: Install]")
  const isPollutedTranslation = (candidate: string): boolean => {
    const c = candidate.trim();
    if (!c) return true;
    if (
      c.includes('ترجمة المصطلح') ||
      c.includes('INVALID TARGET LANGUAGE') ||
      c.includes('MYMEMORY WARNING')
    ) {
      return true;
    }
    // Reject if wrapped in [...] when original source had no brackets
    if (
      c.startsWith('[') &&
      c.endsWith(']') &&
      !coreText.startsWith('[') &&
      !coreText.endsWith(']')
    ) {
      return true;
    }
    return false;
  };

  // Helper for custom API key provider or Yandex built-in
  const tryCustomOrYandexProvider = async (): Promise<string | null> => {
    if (!activeProvider.apiKey && activeProvider.type !== 'yandex_builtin') {
      return null;
    }
    try {
      const pRes = await fetch('/api/providers/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerType: activeProvider.type,
          apiKey: activeProvider.apiKey,
          sourceText: coreText,
          targetLang: directLang,
          targetLocaleName,
          pluralQuantity,
        }),
      });
      if (pRes.ok) {
        const pData = (await pRes.json()) as { translatedText?: string };
        if (pData && typeof pData.translatedText === 'string' && pData.translatedText.trim()) {
          const cleaned = stripMetadataLabels(pData.translatedText, coreText);
          if (cleaned && !isPollutedTranslation(cleaned)) {
            return restoreSegmentSyntax(cleaned, tokens, usesEscapedDoubleQuotes);
          }
        }
      }
    } catch {
      // Fallback if provider request fails
    }
    return null;
  };

  // Helper for Server-Side Gemini AI Suggestion (/api/translate)
  const tryGeminiServer = async (): Promise<string | null> => {
    try {
      const aiRes = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: coreText,
          targetLang: directLang,
          targetLocaleName,
          pluralQuantity,
        }),
      });

      if (aiRes.ok) {
        const aiData = (await aiRes.json()) as { translatedText?: string };
        if (aiData && typeof aiData.translatedText === 'string' && aiData.translatedText.trim()) {
          const cleanedAi = stripMetadataLabels(aiData.translatedText, coreText);
          if (cleanedAi && !isPollutedTranslation(cleanedAi)) {
            return restoreSegmentSyntax(cleanedAi, tokens, usesEscapedDoubleQuotes);
          }
        }
      }
    } catch {
      // Fallback
    }
    return null;
  };

  // Helper for Google Translate GTX neural endpoint
  const tryGoogleGtx = async (): Promise<string | null> => {
    try {
      const googleLang =
        directLang === 'zh-rcn'
          ? 'zh-CN'
          : directLang === 'zh-rtw'
            ? 'zh-TW'
            : directLang === 'pt-rbr'
              ? 'pt-BR'
              : baseLang;
      const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(
        googleLang
      )}&dt=t&q=${encodeURIComponent(cleanText)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const gtxRes = await fetch(gtxUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (gtxRes.ok) {
        const gtxData = await gtxRes.json();
        if (Array.isArray(gtxData) && Array.isArray(gtxData[0])) {
          const combined = gtxData[0]
            .map((chunk: unknown) => (Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : ''))
            .join('');
          const decoded = stripMetadataLabels(decodeHtmlEntities(combined), coreText);
          if (decoded && !isPollutedTranslation(decoded)) {
            return restoreSegmentSyntax(decoded, tokens, usesEscapedDoubleQuotes);
          }
        }
      }
    } catch {
      // Fallback
    }
    return null;
  };

  // Helper for MyMemory API
  const tryMyMemory = async (): Promise<string | null> => {
    try {
      const langPair = `en|${baseLang}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=${langPair}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data && data.responseData && data.responseData.translatedText) {
          let rawResult = stripMetadataLabels(decodeHtmlEntities(data.responseData.translatedText), coreText);

          const hasAllTokens = (textToCheck: string) =>
            tokens.every(
              (tk) =>
                textToCheck.includes(tk.surrogateId) ||
                textToCheck.includes(toArabicIndicDigits(tk.surrogateId)) ||
                textToCheck.includes(tk.rawToken)
            );

          if (
            (isPollutedTranslation(rawResult) || (tokens.length > 0 && !hasAllTokens(rawResult))) &&
            Array.isArray(data.matches)
          ) {
            const betterMatch = data.matches.find((m: { translation?: string }) => {
              if (!m || typeof m.translation !== 'string') return false;
              const decoded = stripMetadataLabels(decodeHtmlEntities(m.translation), coreText);
              if (isPollutedTranslation(decoded)) return false;
              return tokens.length === 0 || hasAllTokens(decoded);
            });
            if (betterMatch && betterMatch.translation) {
              rawResult = stripMetadataLabels(decodeHtmlEntities(betterMatch.translation), coreText);
            }
          }

          if (!isPollutedTranslation(rawResult)) {
            const finalResult = restoreSegmentSyntax(rawResult, tokens, usesEscapedDoubleQuotes);
            if (finalResult) {
              return finalResult;
            }
          }
        }
      }
    } catch (error) {
      console.warn('Machine translation fetch failed, using fallback:', error);
    }
    return null;
  };

  // Order of execution based on the user's selected Translation Provider
  const strategies: Array<() => Promise<string | null>> = [];

  if (!activeProvider.isBuiltIn || activeProvider.type === 'yandex_builtin') {
    strategies.push(tryCustomOrYandexProvider, tryGeminiServer, tryGoogleGtx, tryMyMemory);
  } else if (activeProvider.type === 'google') {
    strategies.push(tryGoogleGtx, tryGeminiServer, tryMyMemory);
  } else if (activeProvider.type === 'mymemory') {
    strategies.push(tryMyMemory, tryGoogleGtx, tryGeminiServer);
  } else {
    // Default: Gemini AI first
    strategies.push(tryGeminiServer, tryGoogleGtx, tryMyMemory);
  }

  for (const runStrategy of strategies) {
    const resText = await runStrategy();
    if (resText) {
      return { text: wrapResult(resText), source: 'mymemory' };
    }
  }

  // Fallback check in glossary if custom provider failed offline
  if (glossaryItem) {
    const match = glossaryItem[directLang] || glossaryItem[baseLang];
    if (match) {
      return { text: wrapResult(match), source: 'glossary' };
    }
  }

  // 4. Fallback Heuristic
  return { text: segment, source: 'heuristic' };
}

/**
 * Main translation function that resolves with the highest quality translation available
 * while preserving 100% of Android syntax (%1$s, %1$d, \n, \\n, multiline \n, quotes, etc.)
 */
export async function suggestTranslation(
  sourceText: string,
  targetLang: string,
  targetLocaleName?: string,
  pluralQuantity?: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
): Promise<{ text: string; source: 'glossary' | 'mymemory' | 'heuristic' }> {
  if (!sourceText || !sourceText.trim()) {
    return { text: '', source: 'glossary' };
  }

  const baseLang = targetLang.split('-')[0].toLowerCase();
  const directLang = targetLang.toLowerCase();

  // Split by Android newline / tab syntax separators so \n, \\n, and multiline \n are 100% untouched
  const separatorRegex = /(\r?\n\\n\r?\n\\n|\r?\n\\n|\\\\n|\\n\\n|\\n|\r?\n|\\t)/g;
  const parts = sourceText.split(separatorRegex);

  if (parts.length === 1) {
    return translateSingleSegment(sourceText, baseLang, directLang, targetLocaleName, pluralQuantity);
  }

  let overallSource: 'glossary' | 'mymemory' | 'heuristic' = 'glossary';
  const translatedParts = await Promise.all(
    parts.map(async (part) => {
      if (!part) return part;
      if (separatorRegex.test(part)) {
        separatorRegex.lastIndex = 0;
        return part; // Keep exact \n / \\n / multiline separator untouched
      }
      separatorRegex.lastIndex = 0;
      const res = await translateSingleSegment(part, baseLang, directLang, targetLocaleName, pluralQuantity);
      if (res.source === 'mymemory') overallSource = 'mymemory';
      return res.text;
    })
  );

  return {
    text: translatedParts.join(''),
    source: overallSource,
  };
}

/**
 * Bulk translates a list of ResourceItems using suggestTranslation with controlled concurrency
 * and live progress reporting.
 */
export async function bulkTranslateItems(
  itemsToTranslate: ResourceItem[],
  targetLang: string,
  targetLocaleName?: string,
  onProgress?: (completed: number, total: number) => void
): Promise<ResourceItem[]> {
  const total = itemsToTranslate.length;
  if (total === 0) return [];

  const normalizedInput = normalizePluralsForLanguage(itemsToTranslate, targetLang);
  const results: ResourceItem[] = new Array(total);
  let completed = 0;

  const translateOneItem = async (item: ResourceItem): Promise<ResourceItem> => {
    if (item.type === 'string') {
      const single = item as SingleStringItem;
      const res = await suggestTranslation(single.source, targetLang, targetLocaleName);
      const targetText = res?.text || single.target;
      const hasTranslation = Boolean(targetText.trim());
      return {
        ...single,
        target: targetText,
        status: hasTranslation ? 'translated' : 'untranslated',
        translationSource: hasTranslation ? 'ai' : undefined,
      };
    }

    if (item.type === 'plural') {
      const plural = item as PluralStringItem;
      const updatedQuantities = await Promise.all(
        plural.items.map(async (pi) => {
          const res = await suggestTranslation(pi.source, targetLang, targetLocaleName, pi.quantity);
          return {
            ...pi,
            target: res?.text || pi.target,
          };
        })
      );
      const anyFilled = updatedQuantities.some((pi) => pi.target.trim().length > 0);
      return {
        ...plural,
        items: updatedQuantities,
        status: anyFilled ? 'translated' : 'untranslated',
        translationSource: anyFilled ? 'ai' : undefined,
      };
    }

    if (item.type === 'array') {
      const arr = item as ArrayStringItem;
      const updatedElements = await Promise.all(
        arr.items.map(async (ai) => {
          const res = await suggestTranslation(ai.source, targetLang, targetLocaleName);
          return {
            ...ai,
            target: res?.text || ai.target,
          };
        })
      );
      const anyFilled = updatedElements.some((ai) => ai.target.trim().length > 0);
      return {
        ...arr,
        items: updatedElements,
        status: anyFilled ? 'translated' : 'untranslated',
        translationSource: anyFilled ? 'ai' : undefined,
      };
    }

    return item;
  };

  // Run with concurrency of 3 to avoid rate limits while remaining fast
  const CONCURRENCY = 3;
  let nextIdx = 0;

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
    while (nextIdx < total) {
      const currentIdx = nextIdx++;
      results[currentIdx] = await translateOneItem(normalizedInput[currentIdx]);
      completed++;
      onProgress?.(completed, total);
    }
  });

  await Promise.all(workers);
  return results;
}
