# إصدار نسخة Release موقّعة / Signed release

## 1) إنشاء مفتاح التوقيع (مرة واحدة فقط)
```bash
keytool -genkeypair -v -keystore release.jks -alias xmltranslator \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 release.jks > release.jks.b64   # على macOS: base64 -i release.jks
```
احتفظ بـ `release.jks` وكلمة المرور في مكان آمن خارج GitHub. فقدانه يعني عدم إمكانية تحديث التطبيق لاحقاً.

## 2) إضافة الأسرار
GitHub ← Settings ← Secrets and variables ← Actions ← New repository secret:

| الاسم | القيمة |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | محتوى `release.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | كلمة مرور المخزن |
| `ANDROID_KEY_ALIAS` | `xmltranslator` |
| `ANDROID_KEY_PASSWORD` | كلمة مرور المفتاح (اختياري، الافتراضي كلمة مرور المخزن) |

## 3) التشغيل
- Actions ← **Release signed Android APK** ← Run workflow ← أدخل رقم النسخة، أو
- `git tag v1.0.0 && git push origin v1.0.0` (يرفق APK بصفحة Releases تلقائياً).

الناتج: `xml-translator-<version>.apk` + ملف `.sha256` في Artifacts.
