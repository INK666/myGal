package com.gamemanage.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import androidx.core.app.NotificationCompat;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSink;
import org.json.JSONObject;

/**
 * 上传前台服务：
 * - OkHttp 分块事务 PUT：整块为提交单位，服务端保证原子 commit / 断连回滚
 * - ParcelFileDescriptor + FileChannel.position(offset) O(1) 断点寻址（不用 InputStream.skip）
 * - 自定义 RequestBody：64KB 堆外缓冲流式写出，内存恒定 <1MB
 * - 409 对齐：服务端返回权威 receivedBytes，自动校正续传位置
 * - 完整性只比对字节数（7GB 手机全量哈希会卡死，服务端写盘时增量算）
 * - 403：PC 端未开启上传许可 / 票据过期 → 明确提示
 */
public class UploadService extends Service {

    private static final String CHANNEL_ID = "upload_channel";
    private static final int NOTI_ID = 2001;
    private static final String ACTION_COMPLETED = "com.gamemanage.mobile.UPLOAD_COMPLETED";

    /** 事件转发到 Plugin → JS（静态回调，比广播可靠） */
    public interface UploadEventListener {
        void onEvent(String event, JSONObject data);
    }

    private static volatile UploadEventListener staticListener;

    public static void setEventListener(UploadEventListener listener) {
        staticListener = listener;
    }

    private static final Map<String, Boolean> cancelledTasks = new ConcurrentHashMap<>();
    private static final Map<String, Boolean> runningTasks = new ConcurrentHashMap<>();

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private OkHttpClient client;

    public static void start(Context context, Uri uri, String serverUrl, String token, String ticket,
                             String taskId, String fileName, long fileSize, long chunkSize) {
        Intent intent = new Intent(context, UploadService.class);
        intent.putExtra("uri", uri.toString());
        intent.putExtra("serverUrl", serverUrl);
        intent.putExtra("token", token);
        intent.putExtra("ticket", ticket);
        intent.putExtra("taskId", taskId);
        intent.putExtra("fileName", fileName);
        intent.putExtra("fileSize", fileSize);
        intent.putExtra("chunkSize", chunkSize);
        cancelledTasks.remove(taskId);
        context.startForegroundService(intent);
    }

    public static void cancel(Context context, String taskId) {
        cancelledTasks.put(taskId, true);
        runningTasks.remove(taskId);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        client = new OkHttpClient.Builder()
                .connectTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
                .writeTimeout(120, java.util.concurrent.TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        final String taskId = intent.getStringExtra("taskId");
        final String uriStr = intent.getStringExtra("uri");
        final String serverUrl = intent.getStringExtra("serverUrl");
        final String token = intent.getStringExtra("token");
        final String ticket = intent.getStringExtra("ticket");
        final String fileName = intent.getStringExtra("fileName");
        final long fileSize = intent.getLongExtra("fileSize", 0);
        final long chunkSize = intent.getLongExtra("chunkSize", 16 * 1024 * 1024);

        startForeground(NOTI_ID, buildNotification(fileName, 0));
        runningTasks.put(taskId, true);
        executor.execute(() -> doUpload(taskId, uriStr, serverUrl, token, ticket, fileName, fileSize, chunkSize));
        return START_NOT_STICKY;
    }

    private void doUpload(String taskId, String uriStr, String serverUrl, String token, String ticket,
                          String fileName, long fileSize, long chunkSize) {
        // 防御：fileSize<=0 时下面的 while 一次都不会执行，会直接走到 notifyCompleted，
        // 造成「客户端已完成、PC 端 0 字节」的假成功。这里显式判错。
        if (fileSize <= 0) {
            notifyPaused(taskId, fileName, 0, 0, "文件大小无效（" + fileSize + " 字节），请重新选择文件");
            maybeStop();
            return;
        }
        if (chunkSize <= 0) chunkSize = 16 * 1024 * 1024;

        ParcelFileDescriptor pfd = null;
        FileChannel channel = null;
        long receivedBytes = 0;
        try {
            ContentResolver resolver = getContentResolver();
            pfd = resolver.openFileDescriptor(Uri.parse(uriStr), "r");
            if (pfd == null) throw new IOException("无法打开所选文件（URI 权限可能已失效，请重新选择）");
            channel = new FileInputStream(pfd.getFileDescriptor()).getChannel();

            int attempt = 0;
            final int maxAttempts = 5;
            String lastStatus = null; // 末次服务端响应里的 data.status

            while (receivedBytes < fileSize && !isCancelled(taskId)) {
                long thisChunk = Math.min(chunkSize, fileSize - receivedBytes);
                try {
                    ChunkResult ack = uploadChunk(serverUrl, token, ticket, channel, receivedBytes, thisChunk, fileSize, taskId);
                    receivedBytes = ack.receivedBytes;
                    if (ack.status != null) lastStatus = ack.status;
                    attempt = 0;
                    notifyProgress(taskId, fileName, receivedBytes, fileSize);
                } catch (AlignException ae) {
                    // 服务端权威字节数，自动对齐（整块边界）
                    receivedBytes = ae.receivedBytes;
                    attempt = 0;
                } catch (PermissionException pe) {
                    notifyPaused(taskId, fileName, receivedBytes, fileSize, pe.getMessage());
                    return;
                } catch (IOException e) {
                    attempt++;
                    if (attempt >= maxAttempts || isCancelled(taskId)) {
                        notifyPaused(taskId, fileName, receivedBytes, fileSize, "网络异常，已暂停（点继续可续传）");
                        return;
                    }
                    try { Thread.sleep(2000L * attempt); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                }
            }

            if (isCancelled(taskId)) {
                notifyCancelled(taskId, fileName);
                return;
            }

            // ★ 完成判定只认服务端：末块响应必须带 status=completed（服务端 rename 成功后才回）。
            //   若字节已收满但没拿到确认（例如收尾时文件被占用、或靠 409 对齐跳到了末尾），
            //   主动调 /complete 请求收尾——绝不在服务端没确认时上报「已完成」。
            if (!"completed".equals(lastStatus)) {
                String fin = requestFinalize(serverUrl, token, ticket, taskId);
                if (!"completed".equals(fin)) {
                    notifyPaused(taskId, fileName, receivedBytes, fileSize, fin);
                    return;
                }
            }

            notifyCompleted(taskId, fileName, fileSize);
            maybeStop();
        } catch (Exception e) {
            notifyPaused(taskId, fileName, receivedBytes, fileSize, "上传失败: " + (e.getMessage() == null ? "未知错误" : e.getMessage()));
            maybeStop();
        } finally {
            if (channel != null) try { channel.close(); } catch (IOException ignored) {}
            if (pfd != null) try { pfd.close(); } catch (IOException ignored) {}
            runningTasks.remove(taskId);
        }
    }

    private void maybeStop() {
        if (runningTasks.isEmpty()) {
            stopForeground(true);
            stopSelf();
        }
    }

    /** 上传一块。返回服务端确认的 receivedBytes 与状态；409 抛 AlignException；403 抛 PermissionException */
    private ChunkResult uploadChunk(String serverUrl, String token, String ticket, FileChannel channel,
                                    long start, long len, long total, String taskId) throws IOException, AlignException, PermissionException {
        channel.position(start); // O(1) 断点寻址

        RequestBody body = new ChunkRequestBody(channel, len);
        Request request = new Request.Builder()
                .url(serverUrl + "/api/uploads/" + ticket)
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/octet-stream")
                .header("Content-Range", "bytes " + start + "-" + (start + len - 1) + "/" + total)
                .put(body)
                .build();

        try (Response resp = client.newCall(request).execute()) {
            int code = resp.code();
            String respBody = resp.body() != null ? resp.body().string() : "";
            if (code == 200) {
                return new ChunkResult(parseReceivedBytes(respBody), parseStatusOrNull(respBody));
            }
            if (code == 409) {
                Long serverReceived = parseReceivedBytesOrNull(respBody);
                if (serverReceived != null) throw new AlignException(serverReceived);
                throw new IOException("服务端对齐失败: " + respBody);
            }
            if (code == 403) {
                throw new PermissionException("PC 端未开启上传许可，或上传票据已过期，请在 PC 端设置中开启「允许移动端上传」后重试");
            }
            if (code == 404) {
                throw new PermissionException("上传票据已失效，请重新发起上传（已传部分会自动续传）");
            }
            throw new IOException("HTTP " + code + ": " + respBody);
        }
    }

    /**
     * 请求服务端收尾（POST /api/uploads/:ticket/complete，幂等）。
     * 返回 "completed" 表示服务端已确认收尾；否则返回可直接展示给用户的原因。
     */
    private String requestFinalize(String serverUrl, String token, String ticket, String taskId) {
        Request request = new Request.Builder()
                .url(serverUrl + "/api/uploads/" + ticket + "/complete")
                .header("Authorization", "Bearer " + token)
                .post(RequestBody.create(new byte[0], MediaType.parse("application/octet-stream")))
                .build();
        try (Response resp = client.newCall(request).execute()) {
            int code = resp.code();
            String respBody = resp.body() != null ? resp.body().string() : "";
            String status = parseStatusOrNull(respBody);
            if (code == 200 && "completed".equals(status)) return "completed";
            if (code == 403) return "PC 端未开启上传许可，或上传票据已过期";
            if (code == 404) return "PC 端已查不到该上传任务（可能已完成或已过期），请在 PC 端确认文件后再决定是否重传";
            if (code == 409) return "服务端尚未收满，请点继续重试续传";
            return "服务端收尾失败（HTTP " + code + "），请点继续重试";
        } catch (IOException e) {
            return "收尾请求失败：" + (e.getMessage() == null ? "网络异常" : e.getMessage());
        }
    }

    /** 解析 { data: { status } }，失败返回 null */
    private String parseStatusOrNull(String body) {
        try {
            JSONObject json = new JSONObject(body);
            if (!json.has("data") || json.isNull("data")) return null;
            JSONObject data = json.getJSONObject("data");
            if (!data.has("status")) return null;
            return data.getString("status");
        } catch (Exception e) {
            return null;
        }
    }

    /** 解析 { data: { receivedBytes } }；解析失败抛 IOException */
    private long parseReceivedBytes(String body) throws IOException {
        Long v = parseReceivedBytesOrNull(body);
        if (v == null) throw new IOException("服务端响应缺少 receivedBytes: " + body);
        return v;
    }

    private Long parseReceivedBytesOrNull(String body) {
        try {
            JSONObject json = new JSONObject(body);
            if (!json.has("data") || json.isNull("data")) return null;
            JSONObject data = json.getJSONObject("data");
            if (!data.has("receivedBytes")) return null;
            return data.getLong("receivedBytes");
        } catch (Exception e) {
            return null;
        }
    }

    private boolean isCancelled(String taskId) {
        Boolean c = cancelledTasks.get(taskId);
        return c != null && c;
    }

    // ---------- 通知与事件 ----------

    private void notifyProgress(String taskId, String fileName, long received, long total) {
        int percent = total > 0 ? (int) (received * 100 / total) : 0;
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.notify(NOTI_ID, buildNotification(fileName, percent));
        } catch (Exception ignored) {}
        emit("uploadProgress", json(taskId, fileName, received, total));
    }

    private void notifyCompleted(String taskId, String fileName, long fileSize) {
        emit("uploadComplete", json(taskId, fileName, fileSize, fileSize));
    }

    private void notifyPaused(String taskId, String fileName, long received, long total, String reason) {
        JSONObject o = json(taskId, fileName, received < 0 ? 0 : received, total);
        try { o.put("reason", reason); } catch (Exception ignored) {}
        emit("uploadPaused", o);
    }

    private void notifyCancelled(String taskId, String fileName) {
        emit("uploadCancelled", json(taskId, fileName, 0, 0));
    }

    private JSONObject json(String taskId, String fileName, long receivedBytes, long fileSize) {
        JSONObject o = new JSONObject();
        try {
            o.put("taskId", taskId);
            o.put("fileName", fileName);
            o.put("receivedBytes", receivedBytes);
            o.put("fileSize", fileSize);
        } catch (Exception ignored) {}
        return o;
    }

    private void emit(String event, JSONObject data) {
        UploadEventListener l = staticListener;
        if (l != null) {
            try { l.onEvent(event, data); } catch (Exception ignored) {}
        }
    }

    // ---------- 自定义 RequestBody：64KB 堆外缓冲流式写 ----------

    private static class ChunkRequestBody extends RequestBody {
        private final FileChannel channel;
        private final long len;
        private static final MediaType OCTET = MediaType.parse("application/octet-stream");

        ChunkRequestBody(FileChannel channel, long len) {
            this.channel = channel;
            this.len = len;
        }

        @Override public MediaType contentType() { return OCTET; }
        @Override public long contentLength() { return len; }

        @Override
        public void writeTo(BufferedSink sink) throws IOException {
            long remaining = len;
            ByteBuffer buf = ByteBuffer.allocateDirect(64 * 1024); // 堆外 64KB，全程复用
            while (remaining > 0) {
                buf.clear();
                int toRead = (int) Math.min(buf.capacity(), remaining);
                buf.limit(toRead);
                int read = channel.read(buf);
                if (read <= 0) throw new IOException("文件读取意外结束（文件可能已被修改或删除）");
                buf.flip();
                sink.write(buf);
                remaining -= read;
            }
        }
    }

    /** 单块上传的服务端回执：已确认字节数 + 服务端状态（completed 才代表真的收尾成功） */
    private static class ChunkResult {
        final long receivedBytes;
        final String status;
        ChunkResult(long receivedBytes, String status) {
            this.receivedBytes = receivedBytes;
            this.status = status;
        }
    }

    private static class AlignException extends Exception {
        final long receivedBytes;
        AlignException(long receivedBytes) { this.receivedBytes = receivedBytes; }
    }

    private static class PermissionException extends Exception {
        PermissionException(String message) { super(message); }
    }

    // ---------- Service 样板 ----------

    private void createChannel() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "游戏上传", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("游戏文件上传进度");
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification(String fileName, int percent) {
        Intent openIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = openIntent != null
                ? PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_IMMUTABLE)
                : null;
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("正在上传: " + fileName)
                .setOngoing(true)
                .setOnlyAlertOnce(true);
        if (percent > 0) {
            b.setContentText(percent + "%").setProgress(100, percent, false);
        } else {
            b.setContentText("准备中...").setProgress(0, 0, true);
        }
        if (pi != null) b.setContentIntent(pi);
        return b.build();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
