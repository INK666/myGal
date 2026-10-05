package com.gamemanage.mobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/**
 * 移动端上传插件（JS 桥）：
 * - pickFile：ACTION_OPEN_DOCUMENT 选单个文件（系统层面禁多选）+ takePersistableUriPermission 持久权限
 * - startUpload / cancelUpload：委托 UploadService（前台服务执行分块上传）
 * - 事件转发：UploadService 的进度/完成/暂停事件经 notifyListeners 推给 JS
 */
@CapacitorPlugin(name = "NativeUploader")
public class NativeUploaderPlugin extends Plugin {

    private PluginCall pendingPickCall;

    @Override
    public void load() {
        UploadService.setEventListener((event, data) -> {
            JSObject payload = new JSObject();
            try {
                payload.put("event", event);
                java.util.Iterator<String> keys = data.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    payload.put(k, data.get(k));
                }
            } catch (Exception ignored) {}
            notifyListeners("uploadEvent", payload);
        });
    }

    @PluginMethod
    public void pickFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        // 不带 EXTRA_ALLOW_MULTIPLE：系统层面只允许选一个文件
        pendingPickCall = call;
        try {
            startActivityForResult(call, intent, "pickFileResult");
        } catch (Exception e) {
            pendingPickCall = null;
            call.reject("无法打开文件选择器: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void pickFileResult(PluginCall call, ActivityResult result) {
        if (call == null) call = pendingPickCall;
        if (call == null) return;
        pendingPickCall = null;

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("未选择文件");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("未选择文件");
            return;
        }

        Context context = getContext();
        ContentResolver resolver = context.getContentResolver();

        // 持久化读权限：进程被系统回收后由前台服务拉起仍可读
        try {
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // 个别 provider 不支持持久授权：进程重建后需重新选择文件
        }

        String fileName = null;
        long fileSize = -1;
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameIdx >= 0) fileName = cursor.getString(nameIdx);
                if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) fileSize = cursor.getLong(sizeIdx);
            }
        } catch (Exception ignored) {}

        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "upload_" + System.currentTimeMillis();
        }
        if (fileSize <= 0) {
            try (android.content.res.AssetFileDescriptor afd = resolver.openAssetFileDescriptor(uri, "r")) {
                if (afd != null) fileSize = afd.getLength();
            } catch (Exception ignored) {}
        }
        if (fileSize <= 0) {
            call.reject("读不到文件大小。若选的是文件夹，请先压缩成单个文件再上传");
            return;
        }

        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("fileName", fileName);
        ret.put("fileSize", fileSize);
        call.resolve(ret);
    }

    @PluginMethod
    public void startUpload(PluginCall call) {
        String uri = call.getString("uri");
        String serverUrl = call.getString("serverUrl");
        String token = call.getString("token");
        String ticket = call.getString("ticket");
        String taskId = call.getString("taskId");
        String fileName = call.getString("fileName", "upload");

        if (uri == null || serverUrl == null || token == null || ticket == null || taskId == null) {
            call.reject("参数不完整");
            return;
        }

        // 注意：不能用 call.getLong()——Capacitor 的实现只在值为 Long 时返回，
        // JS 传来的普通整数会被 JSON 解析成 Integer（大数才是 Long），
        // getLong 会「静默返回默认值」。曾经因此让 fileSize=0 传进服务，
        // 上传循环一次都不执行却上报「已完成」，PC 端只留下 0 字节 .part。
        Object rawFileSize = call.getData() != null ? call.getData().opt("fileSize") : null;
        Object rawChunkSize = call.getData() != null ? call.getData().opt("chunkSize") : null;
        long fileSize = toLong(rawFileSize, 0L);
        long chunkSize = toLong(rawChunkSize, 16 * 1024 * 1024L);
        if (chunkSize <= 0) chunkSize = 16 * 1024 * 1024L;

        if (fileSize <= 0) {
            call.reject("读不到文件大小（" + rawFileSize + "），请重新选择文件后再上传");
            return;
        }

        try {
            UploadService.start(getContext(), Uri.parse(uri), serverUrl, token, ticket, taskId, fileName, fileSize, chunkSize);
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("启动上传服务失败: " + e.getMessage());
        }
    }

    /** 把 JS 传来的任意 Number/String 安全转成 long（getLong 只认 Long，会静默吞掉 Integer/Double） */
    private static long toLong(Object v, long def) {
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d) || d < 0) return def;
            return (long) d;
        }
        if (v instanceof String) {
            try {
                return Long.parseLong(((String) v).trim());
            } catch (Exception ignored) {}
        }
        return def;
    }

    @PluginMethod
    public void cancelUpload(PluginCall call) {
        String taskId = call.getString("taskId");
        if (taskId != null) {
            UploadService.cancel(getContext(), taskId);
        }
        call.resolve();
    }
}
