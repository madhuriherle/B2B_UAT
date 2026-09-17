import React, { createContext, useContext, useState, useCallback } from "react";

const ConfirmContext = createContext();

export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return context;
};

export const ConfirmProvider = ({ children }) => {
  const [modalState, setModalState] = useState({
    isOpen: false,
    message: "",
    type: "confirm", // 'confirm' or 'alert'
    resolve: null,
  });

  const confirm = useCallback((message) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        message,
        type: "confirm",
        resolve,
      });
    });
  }, []);

  const alert = useCallback((message) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        message,
        type: "alert",
        resolve,
      });
    });
  }, []);

  const handleConfirm = () => {
    if (modalState.resolve) modalState.resolve(true);
    closeModal();
  };

  const handleCancel = () => {
    if (modalState.resolve) modalState.resolve(false);
    closeModal();
  };

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  };

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}

      {modalState.isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
          onClick={modalState.type === "alert" ? handleConfirm : handleCancel}
        >
          <div
            className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: "#fff" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b" style={{ borderColor: "#E2EBF4" }}>
              <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>
                {modalState.type === "confirm" ? "Confirm Action" : "Notice"}
              </h2>
            </div>

            <div className="px-6 py-5">
              <p className="text-sm" style={{ color: "#334155", whiteSpace: "pre-wrap" }}>
                {modalState.message}
              </p>
            </div>

            <div
              className="px-6 py-4 border-t flex justify-end gap-2"
              style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}
            >
              {modalState.type === "confirm" && (
                <button
                  onClick={handleCancel}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#5B7285" }}
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleConfirm}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "#C0392B" }}
              >
                {modalState.type === "confirm" ? "Confirm" : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};
