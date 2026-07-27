export type Notification = {
  id: number;
  message: string;
  kind: "success" | "error";
};

export function NotificationStack({
  notifications,
  onDismiss,
}: {
  notifications: Notification[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" aria-live="polite">
      {notifications.map((item) => (
        <div
          key={item.id}
          className={`toast ${item.kind === "error" ? "error" : ""}`}
          role={item.kind === "error" ? "alert" : "status"}
        >
          <span>{item.message}</span>
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => onDismiss(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
