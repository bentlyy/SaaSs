import 'dotenv/config';
import { startProduct } from '@amg/product-runtime';
import { definicion } from './app.js';

startProduct(definicion);
