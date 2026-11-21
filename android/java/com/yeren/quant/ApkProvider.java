package com.yeren.quant;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 把缓存里的 APK 暴露给系统安装器。
 *
 * 为什么不用 FileProvider：那是 androidx 的类，而这个壳刻意不引任何依赖
 * （见 MainActivity 的说明）。Android 7 起 file:// 的 Uri 传给别的应用会
 * 抛 FileUriExposedException，所以必须有个 content:// 的提供者。
 * 自己实现 ContentProvider 只需要 openFile + query 两个方法。
 */
public class ApkProvider extends ContentProvider {

    public static final String AUTHORITY = "com.yeren.quant.apk";
    private static final String NAME = "yeren-update.apk";

    /** APK 落地路径。放 cache 目录，卸载即清，不污染用户空间 */
    public static File fileOf(Context c) {
        return new File(c.getCacheDir(), NAME);
    }

    public static Uri uriFor(Context c) {
        return new Uri.Builder()
            .scheme("content")
            .authority(AUTHORITY)
            .appendPath(NAME)
            .build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    /**
     * 安装器会先 query 出 _display_name 和 _size 再决定怎么展示。
     * 不实现这个方法部分 ROM 会直接判定包损坏。
     */
    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File f = fileOf(getContext());
        if (!f.exists()) return null;

        String[] cols = projection != null && projection.length > 0
            ? projection
            : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};

        MatrixCursor cur = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.SIZE.equals(cols[i])) {
                row[i] = f.length();
            } else {
                row[i] = NAME;
            }
        }
        cur.addRow(row);
        return cur;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileOf(getContext());
        if (!f.exists()) throw new FileNotFoundException(NAME);
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
