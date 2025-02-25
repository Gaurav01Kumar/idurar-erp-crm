const mongoose = require('mongoose');
const moment = require('moment');
const Model = mongoose.model('PaymentInvoice');
const Invoice = mongoose.model('Invoice');
const custom = require('@/controllers/middlewaresControllers/pdfController');
const sendMail = require('./mailInvoiceController');

const createCRUDController = require('@/controllers/middlewaresControllers/createCRUDController');
const methods = createCRUDController('PaymentInvoice');
const { calculate } = require('@/helpers');


delete methods['create'];
delete methods['update'];
delete methods['delete'];

methods.create = async (req, res) => {
  try {
    // Creating a new document in the collection
    if (req.body.amount === 0) {
      return res.status(202).json({
        success: false,
        result: null,
        message: `The Minimum Amount couldn't be 0`,
      });
    }

    const currentInvoice = await Invoice.findOne({
      _id: req.body.invoice,
      removed: false,
    });

    const {
      total: previousTotal,
      discount: previousDiscount,
      credit: previousCredit,
    } = currentInvoice;

    const maxAmount = calculate.sub(calculate.sub(previousTotal, previousDiscount), previousCredit);

    if (req.body.amount > maxAmount) {
      return res.status(202).json({
        success: false,
        result: null,
        message: `The Max Amount you can add is ${maxAmount}`,
      });
    }

    const result = await Model.create(req.body);

    const fileId = 'payment-invoice-report-' + result._id + '.pdf';
    const updatePath = await Model.findOneAndUpdate(
      { _id: result._id.toString(), removed: false },
      { pdfPath: fileId },
      {
        new: true,
      }
    ).exec();
    // Returning successfull response

    const { _id: paymentInvoiceId, amount } = result;
    const { id: invoiceId, total, discount, credit } = currentInvoice;

    let paymentStatus =
      calculate.sub(total, discount) === calculate.add(credit, amount)
        ? 'paid'
        : calculate.add(credit, amount) > 0
        ? 'partially'
        : 'unpaid';

    const invoiceUpdate = await Invoice.findOneAndUpdate(
      { _id: req.body.invoice },
      {
        $push: { paymentInvoice: paymentInvoiceId.toString() },
        $inc: { credit: amount },
        $set: { paymentStatus: paymentStatus },
      },
      {
        new: true, // return the new result instead of the old one
        runValidators: true,
      }
    ).exec();

    await custom.generatePdf(
      'PaymentInvoice',
      { filename: 'payment-invoice-report', format: 'A4' },
      invoiceUpdate
    );

    res.status(200).json({
      success: true,
      result: updatePath,
      message: 'Payment Invoice created successfully',
    });
  } catch (err) {
    // If err is thrown by Mongoose due to required validations
    if (err.name == 'ValidationError') {
      res.status(400).json({
        success: false,
        result: null,
        message: 'Required fields are not supplied',
        error: err,
      });
    } else {
      // Server Error
      res.status(500).json({
        success: false,
        result: null,
        message: 'Oops there is an Error',
        error: err,
      });
    }
  }
};

methods.update = async (req, res) => {
  try {
    if (req.body.amount === 0) {
      return res.status(202).json({
        success: false,
        result: null,
        message: `The Minimum Amount couldn't be 0`,
      });
    }
    // Find document by id and updates with the required fields
    const previousPayment = await Model.findOne({
      _id: req.params.id,
      removed: false,
    });

    const { amount: previousAmount } = previousPayment;
    const { id: invoiceId, total, discount, credit: previousCredit } = previousPayment.invoice;

    const { amount: currentAmount } = req.body;

    const changedAmount = calculate.sub(currentAmount, previousAmount);
    const maxAmount = calculate.sub(total, calculate.add(discount, previousCredit));

    if (changedAmount > maxAmount) {
      return res.status(202).json({
        success: false,
        result: null,
        message: `The Max Amount you can add is ${maxAmount + previousAmount}`,
        error: `The Max Amount you can add is ${maxAmount + previousAmount}`,
      });
    }

    let paymentStatus =
      calculate.sub(total, discount) === calculate.add(previousCredit, changedAmount)
        ? 'paid'
        : calculate.add(previousCredit, changedAmount) > 0
        ? 'partially'
        : 'unpaid';

    const updatedDate = new Date();
    const updates = {
      number: req.body.number,
      date: req.body.date,
      amount: req.body.amount,
      paymentMode: req.body.paymentMode,
      ref: req.body.ref,
      description: req.body.description,
      updated: updatedDate,
    };

    const result = await Model.findOneAndUpdate(
      { _id: req.params.id, removed: false },
      { $set: updates },
      {
        new: true, // return the new result instead of the old one
      }
    ).exec();

    const updateInvoice = await Invoice.findOneAndUpdate(
      { _id: result.invoice._id.toString() },
      {
        $inc: { credit: changedAmount },
        $set: {
          paymentStatus: paymentStatus,
        },
      },
      {
        new: true, // return the new result instead of the old one
      }
    ).exec();

    await custom.generatePdf(
      'PaymentInvoice',
      { filename: 'payment-invoice-report', format: 'A4' },
      updateInvoice
    );

    res.status(200).json({
      success: true,
      result,
      message: 'Successfully updated the Payment ',
    });
  } catch (err) {
    // If err is thrown by Mongoose due to required validations
    if (err.name == 'ValidationError') {
      res.status(400).json({
        success: false,
        result: null,
        message: 'Required fields are not supplied',
        error: err,
      });
    } else {
      // Server Error
      res.status(500).json({
        success: false,
        result: null,
        message: 'Oops there is an Error',
        error: err,
      });
    }
  }
};

methods.delete = async (req, res) => {
  try {
    // Find document by id and updates with the required fields
    const previousPayment = await Model.findOne({
      _id: req.params.id,
      removed: false,
    });

    if (!previousPayment) {
      return res.status(404).json({
        success: false,
        result: null,
        message: 'No document found by this id: ' + req.params.id,
      });
    }

    const { _id: paymentInvoiceId, amount: previousAmount } = previousPayment;
    const { id: invoiceId, total, discount, credit: previousCredit } = previousPayment.invoice;

    // Find the document by id and delete it
    let updates = {
      removed: true,
    };
    // Find the document by id and delete it
    const result = await Model.findOneAndUpdate(
      { _id: req.params.id, removed: false },
      { $set: updates },
      {
        new: true, // return the new result instead of the old one
      }
    ).exec();
    // If no results found, return document not found

    let paymentStatus =
      total - discount === previousCredit - previousAmount
        ? 'paid'
        : previousCredit - previousAmount > 0
        ? 'partially'
        : 'unpaid';

    const updateInvoice = await Invoice.findOneAndUpdate(
      { _id: invoiceId },
      {
        $pull: {
          paymentInvoice: paymentInvoiceId,
        },
        $inc: { credit: -previousAmount },
        $set: {
          paymentStatus: paymentStatus,
        },
      },
      {
        new: true, // return the new result instead of the old one
      }
    ).exec();

    return res.status(200).json({
      success: true,
      result,
      message: 'Successfully Deleted the document by id: ' + req.params.id,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      result: null,
      message: 'Oops there is an Error',
      error: err,
    });
  }
};

methods.summary = async (req, res) => {
  try {
    let defaultType = 'month';

    const { type } = req.query;

    if (type) {
      if (['week', 'month', 'year'].includes(type)) {
        defaultType = type;
      } else {
        return res.status(400).json({
          success: false,
          result: null,
          message: 'Invalid type',
        });
      }
    }

    const currentDate = moment();
    let startDate = currentDate.clone().startOf(defaultType);
    let endDate = currentDate.clone().endOf(defaultType);

    // get total amount of invoices
    const result = await Model.aggregate([
      {
        $match: {
          removed: false,
          date: {
            $gte: startDate.toDate(),
            $lte: endDate.toDate(),
          },
        },
      },
      {
        $group: {
          _id: null, // Group all documents into a single group
          count: {
            $sum: 1,
          },
          total: {
            $sum: '$amount',
          },
        },
      },
      {
        $project: {
          _id: 0, // Exclude _id from the result
          count: 1,
          total: 1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      result: result.length > 0 ? result[0] : { count: 0, total: 0 },
      message: `Successfully fetched the summary of payment invoices for the last ${defaultType}`,
    });
  } catch (error) {
    console.log('error', error);
    return res.status(500).json({
      success: false,
      result: null,
      message: 'Oops there is an Error',
      error: error,
    });
  }
};

methods.sendMail = sendMail;
module.exports = methods;
