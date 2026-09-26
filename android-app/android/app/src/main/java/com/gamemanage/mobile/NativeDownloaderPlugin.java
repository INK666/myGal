package com.gamemanage.mobile;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "NativeDownloader")
public class NativeDownloaderPlugin extends Plugin {

    private String sanitizeFileName(String name) {
        if (name == null || name.trim().isEmpty()) return "game_download";
        // 彻底过滤特殊非法字符（冒号、斜杠、反斜杠、问号、星号、双引号、尖括号、竖线等），防止进入意外子目录或报错
        String sanitized = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "_").trim();
        sanitized = sanitized.replaceAll("^[. ]+|[. ]+$", "");
        return sanitized.isEmpty() ? "game_download" : sanitized;
    }

    @PluginMethod
    public void startDownload(PluginCall call) {
        String url = call.getString("url");
        String rawFileName = call.getString("fileName", "download");
        String safeFileName = sanitizeFileName(rawFileName);
        String title = call.getString("title", safeFileName);
        String description = call.getString("description", "正在通过局域网下载游戏文件...");

        if (url == null || url.trim().isEmpty()) {
            call.reject("URL 不能为空");
            return;
        }

        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(title);
            request.setDescription(description);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            request.addRequestHeader("Connection", "keep-alive");
            request.addRequestHeader("Keep-Alive", "timeout=120");

            // 设置 MIME 类型以帮助系统识别
            String lower = safeFileName.toLowerCase();
            if (lower.endsWith(".zip")) request.setMimeType("application/zip");
            else if (lower.endsWith(".7z")) request.setMimeType("application/x-7z-compressed");
            else if (lower.endsWith(".rar")) request.setMimeType("application/x-rar-compressed");
            else if (lower.endsWith(".iso")) request.setMimeType("application/x-iso9660-image");
            else request.setMimeType("application/octet-stream");

            // 保存至系统公共 Download 目录，确保物理文件名清晰规范
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeFileName);

            DownloadManager downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager == null) {
                call.reject("系统下载管理器不可用");
                return;
            }

            long downloadId = downloadManager.enqueue(request);

            File targetFile = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), safeFileName);

            JSObject ret = new JSObject();
            ret.put("downloadId", String.valueOf(downloadId));
            ret.put("fileName", safeFileName);
            ret.put("savedPath", targetFile.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("启动系统下载失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void checkProgress(PluginCall call) {
        String idStr = call.getString("downloadId");
        if (idStr == null || idStr.trim().isEmpty()) {
            call.reject("downloadId 不能为空");
            return;
        }

        try {
            long downloadId = Long.parseLong(idStr);
            DownloadManager downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager == null) {
                call.reject("系统下载管理器不可用");
                return;
            }

            DownloadManager.Query query = new DownloadManager.Query();
            query.setFilterById(downloadId);
            Cursor cursor = downloadManager.query(query);

            if (cursor != null && cursor.moveToFirst()) {
                int bytesDownloadedIndex = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
                int totalSizeIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
                int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                int reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON);
                int uriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);

                long bytesDownloaded = bytesDownloadedIndex != -1 ? cursor.getLong(bytesDownloadedIndex) : 0;
                long totalSize = totalSizeIndex != -1 ? cursor.getLong(totalSizeIndex) : 0;
                int status = statusIndex != -1 ? cursor.getInt(statusIndex) : DownloadManager.STATUS_FAILED;
                int reason = reasonIndex != -1 ? cursor.getInt(reasonIndex) : 0;
                String localUri = uriIndex != -1 ? cursor.getString(uriIndex) : "";

                cursor.close();

                String statusStr = "UNKNOWN";
                if (status == DownloadManager.STATUS_PENDING) statusStr = "PENDING";
                else if (status == DownloadManager.STATUS_RUNNING) statusStr = "RUNNING";
                else if (status == DownloadManager.STATUS_PAUSED) statusStr = "PAUSED";
                else if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    statusStr = "SUCCESSFUL";
                    // 广播通知系统媒体库扫描刚下载完成的文件，使手机“文件管理”的分类与最近视图立即可见
                    if (localUri != null && !localUri.isEmpty()) {
                        try {
                            Uri parsed = Uri.parse(localUri);
                            String filePath = parsed.getPath();
                            if (filePath != null) {
                                MediaScannerConnection.scanFile(getContext(), new String[]{filePath}, null, null);
                            }
                        } catch (Exception ignored) {}
                    }
                } else if (status == DownloadManager.STATUS_FAILED) {
                    statusStr = "FAILED";
                }

                JSObject ret = new JSObject();
                ret.put("downloadId", idStr);
                ret.put("bytesDownloaded", bytesDownloaded);
                ret.put("totalSize", totalSize);
                ret.put("status", statusStr);
                ret.put("reason", reason);
                ret.put("localUri", localUri);
                call.resolve(ret);
            } else {
                if (cursor != null) cursor.close();
                JSObject ret = new JSObject();
                ret.put("downloadId", idStr);
                ret.put("status", "NOT_FOUND");
                call.resolve(ret);
            }
        } catch (Exception e) {
            call.reject("查询下载进度失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String idStr = call.getString("downloadId");
        if (idStr == null || idStr.trim().isEmpty()) {
            call.reject("downloadId 不能为空");
            return;
        }

        try {
            long downloadId = Long.parseLong(idStr);
            DownloadManager downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager != null) {
                downloadManager.remove(downloadId);
            }
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("取消下载失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openDownloadsFolder(PluginCall call) {
        try {
            Intent intent = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("打开系统下载管理器失败: " + e.getMessage());
        }
    }
}
