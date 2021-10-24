const {createLogger, format, transports} = require('winston');

exports.logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        format.errors({stack: true}),
        format.splat(),
        format.json()
    ),
    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.printf(function (info) {
                    let date = new Date().toISOString().replace(/T/, ' ').replace(/Z/, '');
                    return `${date} [${info.level}]: ${JSON.stringify(info.message, null, 4)}`;
                })
            )
        })
    ]
});