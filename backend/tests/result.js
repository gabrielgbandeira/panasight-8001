/**
 * Envelope Result e padronização de AppError
 * Em conformidade com a Regra 5 (Resilient Error Handling & Observability)
 */
class AppError extends Error {
    constructor({ code, message, layer, operation, metadata = {} }) {
        super(message);
        this.code = code;
        this.layer = layer; // 'DOMAIN' | 'ADAPTER' | 'ENTRYPOINT'
        this.operation = operation;
        this.metadata = metadata;
        this.timestamp = new Date().toISOString();
    }
}

const success = (data) => ({
    success: true,
    data,
    error: null
});

const failure = (error) => ({
    success: false,
    data: null,
    error: error instanceof AppError ? error : new AppError({
        code: 'GENERIC_ERROR',
        message: error.message || String(error),
        layer: 'ADAPTER',
        operation: 'UNKNOWN',
        metadata: { original: error }
    })
});

module.exports = {
    AppError,
    success,
    failure
};
