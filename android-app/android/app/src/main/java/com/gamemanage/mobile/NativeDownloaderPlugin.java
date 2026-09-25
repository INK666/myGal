package com.gamemanage.mobile;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeDownloader")
public class NativeDownloaderPlugin extends Plugin {

    @PluginMethod
    public void startDownload(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName", "download");
        String title = call.getString("title", fileName);
        String description = call.getString("description", "正在下载游戏文件...");

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

            // 保存至系统公共 Download 目录
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

            DownloadManager downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager == null) {
                call.reject("系统下载管理器不可用");
                return;
            }

            long downloadId = downloadManager.enqueue(request);

            JSObject ret = new JSObject();
            ret.put("downloadId", String.valueOf(downloadId));
            ret.put("fileName", fileName);
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

                long bytesDownloaded = bytesDownloadedIndex != -1 ? cursor.getLong(bytesDownloadedIndex) : 0;
                long totalSize = totalSizeIndex != -1 ? cursor.getLong(totalSizeIndex) : 0;
                int status = statusIndex != -1 ? cursor.getInt(statusIndex) : DownloadManager.STATUS_FAILED;
                int reason = reasonIndex != -1 ? cursor.getInt(reasonIndex) : 0;

                cursor.close();

                String statusStr = "UNKNOWN";
                if (status == DownloadManager.STATUS_PENDING) statusStr = "PENDING";
                else if (status == DownloadManager.STATUS_RUNNING) statusStr = "RUNNING";
                else if (status == DownloadManager.STATUS_PAUSED) statusStr = "PAUSED";
                else if (status == DownloadManager.STATUS_SUCCESSFUL) statusStr = "SUCCESSFUL";
                else if (status == DownloadManager.STATUS_FAILED) statusStr = "FAILED";

                JSObject ret = new JSObject();
                ret.put("downloadId", idStr);
                ret.put("bytesDownloaded", bytesDownloaded);
                ret.put("totalSize", totalSize);
                ret.put("status", statusStr);
                ret.put("reason", reason);
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
}
